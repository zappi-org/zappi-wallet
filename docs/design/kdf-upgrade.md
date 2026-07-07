# KDF 상향 설계 — PBKDF2 반복수 상향 + 재암호화 마이그레이션 (R2-D)

- 상태: **이중 리뷰 완료(2026-07-07) — 가이드 APPROVED(3 MINOR) + 블라인드 APPROVED(1 MAJOR
  +2 MINOR). 두 리뷰의 지적을 본 문서에 반영함** (MAJOR-1 다운그레이드 lockout 복구 문면 정정
  §6.4/F11 + 마이그레이션 lockout 소거 하드닝, 양방향 readback §5.4, F13 지연 행, getWalletWithTag,
  구현 추정 상향). 블라인드가 벤치 동기기 재현·OWASP 원문 대조를 독립 수행. 아키텍처(KDF 선택·
  버전·원자성/CAS·다운그레이드 비파괴성)는 양 리뷰가 건전 판정. **구현 착수는 소유자 결정이며,
  구현물은 R2-D 게이트(가이드+블라인드 이중 리뷰)를 다시 받는다.**
- 기준 커밋: `50b088a` · 작성/실측/출처 확인일: 2026-07-07 · 이중 리뷰 반영: 2026-07-07
- 발단: `docs/audit/2026-07-06-non-network-refactoring-audit.md` §6 [중간] —
  "PBKDF2 100k × 6자리 PIN | `encryption.adapter.ts` | OWASP 권고(≥600k) 미달 + PIN 엔트로피 ~20bit.
  디바이스 키 이중 래핑이 완화 | 반복수 상향(재암호화 마이그레이션) 또는 Argon2id | M"
- 계획 필수 축: `tasks/todo.md` R2-D ① hashPassword 재해시 마이그레이션 ② passkey PRF 스코프 판정
  ③ kdfVersion + 크래시 원자성 + 다운그레이드 graceful 실패 ④ Argon2id 평가 + unlock 지연 실측 + half-wipe/자동잠금 상호작용

이 문서의 모든 주장은 (a) 기준 커밋의 실코드 위치, (b) 이 문서를 위해 수행한 실측, (c) 출처 URL
중 하나를 근거로 갖는다. 근거가 추정인 곳은 **[추정]** 으로 명시한다.

---

## 1. 현황 암호 자산 지도

### 1.1 자산 표 — 무엇을 무엇으로부터 보호하나

| # | 자산 | 위치 | 보호 메커니즘 | 방어 대상 | KDF 관련성 |
|---|------|------|--------------|-----------|-----------|
| A1 | **니모닉 (자금의 뿌리)** | `zappi-secure` IDB `wallet/current` 레코드 내 `encryptedMnemonic` | AES-256-GCM, 키 = PBKDF2-SHA256(**PIN**, salt 16B, **100k**) — `encryption.adapter.ts:73-94` `deriveKey` | 레코드를 손에 넣은 오프라인 공격자의 PIN 브루트포스 | **본 설계의 대상** |
| A2 | **PIN 검증자 (passwordHash)** | 동일 레코드의 `passwordHash`/`passwordSalt` | PBKDF2-SHA256 deriveBits 256 (**동일 상수 100k 공유**) — `encryption.adapter.ts:49-71` `hashPassword`, 상수시간 비교 `security.service.ts:202-209` | PIN 추측의 빠른 오라클화 방지 | **본 설계의 대상** (축 ①) |
| A3 | **지갑 레코드 전체 (외곽층)** | `zappi-secure` IDB (`secure-storage.adapter.ts`) | non-extractable AES-256-GCM 기기 키(`:65-69`)로 StoredWallet JSON 을 통째 재암호화 후 저장(`:35-48`) | 디스크 복사·타 오리진·JS 외부에서의 레코드 탈취 | 간접 — KDF 는 이 층이 뚫린 뒤의 최후 방어선 |
| A4 | **passkey 암호화 PIN** | `localStorage['passkey_encrypted_pin_v3']` | AES-256-GCM, 키 = PBKDF2-SHA256(**PRF 출력 32B**, salt 16B, **별도 상수 100k**) — `passkey.ts:47,121-142` | PRF 출력 없는 자의 PIN 평문 획득 (PRF 출력은 생체인증으로만 획득, 비저장 — `passkey.ts:5-9`) | **스코프 제외** (축 ② — §4.2 판정) |
| A5 | 세션 비밀 (키쌍·시드·니모닉 캐시) | `SecurityService.cachedKeys/cachedSeed` + `SeedCache` (`security.service.ts:20-21,89-91`) | 메모리 전용, `lock()` 이 소거 (`:193-197`) | 자리 비운 기기의 물리 접근 (자동잠금 `use-auto-lock.ts`) | 무관 — 저장물 아님 |

구조 관계 (이중 봉투):

```
디스크 (IDB zappi-secure)
└─ EncryptedRecord { iv, ciphertext }            ← 외곽: 기기 키 (non-extractable, A3)
   └─ StoredWallet (JSON)                        ← 여기부터가 KDF 의 세계
      ├─ encryptedMnemonic { ciphertext, salt, iv }   ← 내곽: PBKDF2(PIN)→AES-GCM (A1)
      ├─ passwordHash / passwordSalt                  ← PIN 검증자 (A2)
      ├─ publicKey / createdAt
      └─ (신설 예정) kdfVersion
```

### 1.2 흐름 실측 — PIN 평문이 존재하는 순간

`StoredWallet` 정의: `secure-storage.port.ts:3-9`. 소비자는 `SecurityService` 가 유일하다
(전역 grep — `getWallet/saveWallet` 호출은 `security.service.ts` 의 7곳뿐, 조립은 `composition/security.ts:24-28` 싱글턴).

| 경로 | PIN 평문 보유 | PBKDF2 실행 횟수 | 저장 쓰기 |
|------|--------------|------------------|-----------|
| `createWallet` (`security.service.ts:37-71`) | O | 2 (encrypt 1 + hash 1) | saveWallet 1회 |
| `unlock` (`:73-97`) | O | 2 (hash 검증 1 + decrypt 1) | **없음 — 현행 unlock 은 순수 읽기** |
| `verifyPassword` (`:99-111`) | O | 1 (hash) | 없음 |
| `changePassword` (`:113-145`) | O (구/신 둘 다) | 4 (구 hash + 구 decrypt + 신 encrypt + 신 hash) | saveWallet 1회 — **전체 레코드 재작성 선례** |
| `getMnemonic` (`:147-164`) | O | 2 | 없음 |
| passkey 해제 (`LockScreen.tsx:99-101`) | O (복호화된 PIN) | 위 unlock 과 동일 (PIN 을 `onUnlock` 으로 전달) | 없음 |

핵심 관찰 두 가지:

1. **PIN 은 6자리 숫자로 고정이다.** 온보딩이 6자리에서 자동 확정하고 초과 입력을 차단한다
   (`OnboardingScreen.tsx:162-173`), 잠금 화면도 6자리에서 자동 제출한다 (`LockScreen.tsx:189-193`).
   → PIN 공간 = 정확히 10^6 ≈ 2^19.9.
2. **unlock 은 현재 스토리지에 쓰지 않는다.** 마이그레이션은 unlock 을 처음으로 쓰기 주체로
   만든다 — 이것이 §6 경합 설계의 출발점이다.

### 1.3 hashPassword 의 salt 처리 특이점 (v1 의미 동결 대상)

`hashPassword` 는 salt 를 **hex 문자열 그대로 TextEncoder 로 인코딩**한다
(`encryption.adapter.ts:59-65` — `salt: encoder.encode(salt)`). 즉 16바이트 난수의 hex 표기
32자가 ASCII 32바이트 salt 로 쓰인다. 보안상 문제는 아니지만(salt 는 유일성만 필요),
**v2 에서도 이 의미를 그대로 유지한다** — 이번 변경에서 움직이는 것은 반복수 하나뿐이어야
하고, salt 의미까지 바꾸면 v1 검증 경로와 회귀 테스트가 이유 없이 복잡해진다.

---

## 2. 위협 모델 — 무엇이 최약점인가

### 2.1 공격자 모델

| 공격자 | 획득물 | 현행 방어 | 판정 |
|--------|--------|-----------|------|
| T1. 온라인 추측 (기기를 쥔 타인) | UI 접근 | 5회 실패 → 15분 잠금 (`LockScreen.tsx:43-44,146-166`, localStorage `lockout`) | KDF 무관. 잠금이 주 방어 |
| T2. 디스크 복사 (프로파일 탈취) | `zappi-secure` 의 `EncryptedRecord` | 외곽 기기 키 — non-extractable 이라 JS 로 반출 불가 (`secure-storage.adapter.ts:65-69`) | 외곽층이 1차 방어. 단, non-extractable 은 **WebCrypto API 수준의 보증**이며 브라우저 내부의 디스크 직렬화 형식까지 암호화를 보증하지 않는다 — 본 설계는 보수적으로 "외곽층은 우회될 수 있다"고 가정한다 (감사 원문도 '완화'로만 표기) |
| T3. **StoredWallet 평문 JSON 을 획득한 오프라인 공격자** (T2 성공 또는 JS 컨텍스트 침해) | `passwordHash`+`passwordSalt`+`encryptedMnemonic` | **PBKDF2 100k 하나** | **본 설계의 대상 시나리오** |
| T4. PRF 출력 탈취 | passkey 암호문 | 생체인증 하드웨어 경계 | §4.2 — KDF 반복수의 방어 기여 없음 |

### 2.2 T3 의 산수 — 그리고 정직한 한계

T3 공격자는 후보 PIN 하나를 확인하는 데 두 오라클 중 **싼 쪽**을 쓴다:

- `passwordHash` 검증: PBKDF2 1회 (AES 불필요 — deriveBits 결과를 hex 비교만 하면 됨)
- `encryptedMnemonic` 복호: PBKDF2 1회 + AES-GCM 태그 검증 1회

→ 니모닉 쪽 반복수만 올리면 공격자는 그냥 `passwordHash` 오라클로 PIN 을 찾은 뒤 그 PIN 으로
니모닉을 정상 복호화한다. **두 경로의 비용은 반드시 함께 움직여야 한다** — 이것이 축 ① 이
"치명"인 이유이고, 마이그레이션이 레코드의 두 필드를 원자적으로 함께 재작성해야 하는 이유다.

정직한 한계: PIN 공간이 10^6 이므로, 반복수 상향은 공격 비용을 **선형 배수**(100k→600k = 6배)로
올릴 뿐 10^6 공간의 전수를 "불가능"으로 만들지 못한다. 이 공격은 이론이 아니다 — 동일 구성
(브라우저 지갑의 PBKDF2-SHA256 vault)에 대한 hashcat 크래킹은 MetaMask vault 를 대상으로
공개적으로 논의·수행되어 왔다 (hashcat issue #2818, #4022 — 부록 C-5). GPU 1대가 10^6 공간을
훑는 시간은 100k 에서도 600k 에서도 실용 범위(분~시간대)라고 보는 것이 합리적이다
**[추정 — 자릿수 판단이며 특정 GPU 의 검증된 수치는 확보하지 못함]**. 따라서:

- 6자리 PIN 의 실질 방어선은 **외곽 기기 키(T2 차단) + 온라인 잠금(T1 차단)**이고,
- 반복수 상향의 실익은 (a) 감사·표준 기준선(OWASP) 충족, (b) T3 공격자 비용의 6배 인상,
  (c) 향후 PIN 정책 강화(영숫자·길이) 시 그 엔트로피가 제값을 하게 하는 기반, 그리고
  (d) **kdfVersion 인프라 자체** — 한 번 깔리면 다음 상향(v3)은 상수 추가로 끝난다.

과장하지 않는다: 이 변경은 "6자리 PIN 을 안전하게 만드는" 변경이 아니라 **최후 방어선의
표준 미달을 해소하고 상향 가능 구조를 까는** 변경이다.

### 2.3 최약점 순위 (T3 기준)

1. `passwordHash` @100k — 가장 싼 오라클 (축 ①)
2. `encryptedMnemonic` @100k — 동률 (AES 1회는 PBKDF2 10만 회 대비 무시 가능)
3. passkey 암호문 @100k — PRF 32B 입력이라 반복수 무관하게 사실상 공격 불가 (§4.2)

---

## 3. 목표 파라미터 — 실측 근거

### 3.1 이 기기 실측 (선행 실측 #2)

측정: Node v25.9.0 (`globalThis.crypto.subtle.deriveBits`, OpenSSL 네이티브), Apple M5 (arm64),
warmup 2회 + 본측정 7회의 중앙값. 스크립트·원출력은 부록 A.

| 반복수 | deriveBits(256) 1회 중앙값 | min / max |
|--------|---------------------------|-----------|
| 100,000 | **7.0 ms** | 6.9 / 7.2 |
| 300,000 | 21.1 ms | 20.9 / 21.2 |
| 600,000 | **42.8 ms** | 42.3 / 44.9 |
| 1,000,000 | 71.2 ms | 70.7 / 71.7 |

반복수에 대해 선형(≈7.1ms/100k)이다 — PBKDF2 의 구조상 당연하며, 임의 목표치의 지연을
외삽할 수 있는 근거가 된다.

엔진 주의: Node(OpenSSL)·Chromium(BoringSSL)·Safari(CommonCrypto) 모두 네이티브 구현으로
동급이지만 동일하지는 않다. 이 표는 "이 기기·이 엔진"의 수치이고, 절대값의 이식에는 아래
보정 계수를 적용한다.

### 3.2 unlock 지연 모델 — 모바일 보정

unlock 1회 = PBKDF2 **2회** (hash 검증 + 복호 deriveKey — §1.2). 저가 모바일 보정 계수는
**×3~×5 [추정 — 엔지니어링 마진]**: Apple M5 는 최상급 데스크톱 코어이고, 보급형 Android
(Cortex-A5x 급)의 단일코어 성능은 통상 그 1/3~1/5 이다. 방증 데이터 하나: 2026년 실무 가이드가
보고한 Snapdragon 730(중급 Android) 의 PBKDF2-SHA256 600k 1회 = **210ms** (부록 C-6, 단
in-browser 여부 미명시 — ballpark 전용) → 본 실측 42.8ms 대비 **×4.9**, 마진 대역과 일치한다.
실기기 수치가 아니므로 출시 게이트에 중저가 실기기 1대 실측을 넣는다 (§8, 미해결 질문 #1).

| 시나리오 | 이 기기 | 모바일 ×3 | 모바일 ×5 |
|----------|---------|-----------|-----------|
| 현행 v1 unlock (2×100k) | 14 ms | 42 ms | 70 ms |
| **목표 v2 unlock (2×600k)** | **86 ms** | **257 ms** | **428 ms** |
| 마이그레이션 unlock 1회 (2×100k + **4**×600k — 구현 리뷰 정정: §5.4 양방향 readback 이 hash 재파생 1회 추가) | **186 ms** | **556 ms** | **926 ms** |

> 구현 리뷰 MINOR-1 정정: 초안은 3×600k(encrypt+hash+니모닉 readback)로 추정했으나, 양방향
> readback(§5.4)이 hash readback 1회를 더해 실측 4×600k 다. 최악 보정 ~0.93초로 여전히 1.5초
> 재논의 임계 미만이라 침묵 수행 판정 불변. hash readback 자체는 결정론적 재계산이라 방어
> 가치가 한계적(자기 산출물 대조)이지만 fail-safe(불일치=스킵+재시도)라 존치 — 제거는 니모닉
> readback 과의 대칭만 잃을 뿐 안전을 더하지 않으므로 구현 리뷰가 비차단 처리했다.

판정: v2 정상 unlock 은 최악 보정에서도 0.5초 미만 — 잠금 화면의 기존 로딩 상태
(`LockScreen.tsx` `isLoading`) 안에 흡수된다. 마이그레이션은 **평생 1회** ~0.7초로,
전용 UX 없이 침묵 수행이 타당하다 (>1.5초 실측 시 재논의 — 미해결 질문 #2).

### 3.3 목표: PBKDF2-SHA256 600,000 회 (v2)

- **OWASP Password Storage Cheat Sheet (2026-07-07 원문 검증): PBKDF2-HMAC-SHA256 = 600,000 회.**
  FIPS 조항 원문: "If FIPS-140 compliance is required, use PBKDF2 with a work factor of
  600,000 or more and set with an internal hash function of HMAC-SHA-256." (부록 C-1)
  — 단, OWASP 의 **1순위 권고는 Argon2id** 다. PBKDF2 600k 는 문서화된 FIPS/호환 폴백이며,
  우리가 폴백을 선택하는 근거는 §3.4 에서 정면으로 다룬다.
- 업계 선례 (부록 C-5): **MetaMask 확장이 동일 선택** — 브라우저 vault 의 PBKDF2 를 역사적
  10,000회에서 **600,000회로 상향**했고(현행 main 소스에 `encryptorFactory(600_000)` 검증,
  2026-07) Argon2 로 갈아타지 않았다. Bitwarden 도 2026.2.1 릴리스에서 PBKDF2 최소 반복수를
  600,000 으로 올렸다. 부가 관찰: MetaMask 는 기존 vault 를 자동 재암호화하지 않는 것으로
  보고된다(커뮤니티 보고) — 본 설계의 unlock 시 전량 마이그레이션(§5)은 그보다 강한 보증이다.
- 지연 예산: §3.2 — 최악 보정 0.43초/회로 수용 범위 (Snapdragon 730 방증 210ms/회와 정합).
- 1M 기각: 표준 앵커가 없고(OWASP 문면 600k), 10^6 PIN 공간에서 6배→10배의 차이는 방어
  서사를 바꾸지 못하며, 마이그레이션 1회 지연만 키운다. kdfVersion 구조가 깔리므로 필요 시
  v3 으로 올리는 비용이 상수 한 줄이다.
- 두 경로(A1 니모닉 deriveKey, A2 passwordHash) **모두** 600k — §2.2 의 최약점 동조 원칙.
- salt 의미·AES-GCM 파라미터·레코드 형태는 불변 — 움직이는 것은 반복수와 kdfVersion 필드뿐.

### 3.4 Argon2id 평가 — 이번 라운드 기각, v3 후보로 이월 (축 ④)

감사 원문이 대안으로 제시했고, OWASP 의 1순위이기도 하다 (권고 파라미터: 최소 19 MiB /
t=2 / p=1 — 부록 C-1). 메모리 경도는 GPU 공격자에 대해 PBKDF2 의 선형 배수보다 질적으로
나은 방어가 맞다. 조사 결과를 있는 그대로 놓고 판정한다:

**조사로 기각된 반대 논거 (정직 기재)** — 아래는 Argon2id 를 기각할 이유가 *못 된다*:

- ~~"성능이 나쁘다"~~ — WASM 구현은 네이티브 대비 ~6–8% 이내 (hash-wasm/argon2ian 실측,
  부록 C-3/C-6). OWASP 최소 파라미터의 모바일 지연 추정 100–400ms — PBKDF2 600k 와 동급.
- ~~"iOS 메모리 한계"~~ — 19–46 MiB 급 WASM 할당이 iOS Safari **탭/PWA** 에서 실패했다는
  문서화된 사례 없음. 유명한 "64 MiB 한계"는 iOS **앱 확장(autofill) 쿼터** 문제다
  (Bitwarden/KeePassXC 사례 — 부록 C-4). 우리는 앱 확장이 없다.
- ~~"PWA/Vite 통합 마찰"~~ — hash-wasm 은 WASM 을 base64 인라인으로 배포해 별도 .wasm
  fetch·SW 프리캐시 특수 처리가 불필요 (부록 C-3).

**그럼에도 기각하는 실제 이유:**

| 축 | 사실 | 판정 |
|----|------|------|
| 브라우저 네이티브 부재 | WebCrypto `deriveBits` 알고리즘은 ECDH/HKDF/PBKDF2/X25519 뿐. WICG 제안은 표준 트랙 밖, Mozilla "neutral", Chromium 2026 오리진 트라이얼은 Argon2 **제외** (부록 C-2) | 수년간 WASM 유저랜드 의존이 유일 경로 — 일시적 다리가 아니라 장기 의존이 됨 |
| 공급망·감사 표면 | 후보 실사: argon2-browser 는 최종 릴리스 2021-06-05 로 사실상 휴면; @noble/hashes 순수 JS 는 관리자 스스로 비권장("Argon2 can't be fast in JS … attackers have bigger advantage", 자체 벤치 t=1/m=256MB = 2,881ms); 유일한 건실 후보 = hash-wasm (11.6 KB gzip 실측, 최종 릴리스 2024-11) (부록 C-3) | 자금의 뿌리(니모닉) 암호화 경로에 서드파티 WASM 바이너리 신규 편입 — 현행 스택은 WebCrypto 네이티브 + noble 유틸뿐(`encryption.adapter.ts:2-4` "번들 크기 추가 0" 이 설계 의도). 편익이 이 표면 확대를 정당화해야 함 |
| 실이득의 크기 | §2.2 — 10^6 PIN 공간에서는 Argon2id 도 오프라인 전수를 막지 못한다. 메모리 경도의 질적 이득이 유의미해지는 것은 PIN 엔트로피가 올라간 뒤 | 지금 지불할 비용(위 표면) 대비 지금 얻는 이득이 얇음 |
| 되돌릴 수 있는 결정인가 | kdfVersion 레지스트리(§5.2)가 깔리면 Argon2id 는 **v3 으로 비파괴 도입 가능** — 오늘의 기각이 문을 닫지 않음 | 결정을 미룰 수 있을 때 표면 확대는 미룬다 |
| 선례 | 동일 처지(브라우저 지갑)의 MetaMask = PBKDF2 600k 유지. Bitwarden 은 Argon2id 를 WASM 으로 제공 — "불가능하지 않음"의 증거이지 "지금 해야 함"의 증거는 아님 (부록 C-5) | 폴백 선택은 생태계 표준 관행 범위 내 |

**결론: v2 = PBKDF2-SHA256 600k (무의존·전 플랫폼 네이티브). Argon2id 는 PIN 정책 강화
(엔트로피 상향)와 묶어 v3 에서 재평가** — 그 시점의 1후보는 hash-wasm(관리 상태 재확인 전제),
파라미터는 OWASP 최소선(19 MiB/t=2/p=1)에서 실기기 검증으로 확정. 이는 감사 권고 문면
("반복수 상향 **또는** Argon2id")의 전자를 선택하는 것이며, OWASP 기준으로는 문서화된
FIPS/호환 폴백 경로다.

---

## 4. 스코프 판정

### 4.1 포함: StoredWallet 의 두 KDF 경로 (A1 + A2)

§2.2 의 최약점 동조 원칙. 마이그레이션 트리거·원자성은 §5.

### 4.2 제외: passkey PRF 경로 (A4) — 축 ② 판정

**판정: 스코프 제외 (100k 동결). 근거:**

1. **입력 엔트로피가 다른 종이다.** PBKDF2 반복수의 존재 이유는 저엔트로피 입력(PIN)의
   후보당 검증 비용을 곱하는 것이다. passkey 경로의 KDF 입력은 WebAuthn PRF 출력 32바이트
   (`passkey.ts:121-142`) — 인증기가 생성하는 균등 256bit 비밀로, 후보 열거 자체가 성립하지
   않는다. 반복수 1회든 100만 회든 2^256 공간 앞에서는 방어 기여가 0 이다. 여기서 PBKDF2 는
   스트레칭이 아니라 단순 키 유도(KDF) 역할만 한다.
2. **PRF 출력은 저장되지 않는다** (`passkey.ts:8` — 생체인증 시에만 획득). 공격자가 암호문
   (`localStorage['passkey_encrypted_pin_v3']`)을 얻어도 키 재료가 없다. 방어선은 인증기
   하드웨어이지 반복수가 아니다.
3. **올리면 손해만 있다.** 반복수를 올리면 (a) 생체인증 해제 지연만 증가하고, (b) 기존
   암호문(salt 별 파생)과의 호환을 위해 v3 포맷 재등록 마이그레이션이 또 필요해진다
   (`passkey.ts:15` 포맷 버전 체계) — 이득 0 에 비용만 양수.
4. 조치: `passkey.ts:46-47` 의 상수에 "PRF 고엔트로피 입력 전제 — encryption.adapter 의
   반복수 상향과 무관하게 동결. 근거: docs/design/kdf-upgrade.md §4.2" 주석 1줄 추가 (구현 단계).
   passkey 저장물은 `kdfVersion` 과 완전 무관하므로 마이그레이션 상호작용도 없다 (§7 F8).

### 4.3 제외 (기타)

§10 비범위 참조.

---

## 5. 마이그레이션 설계

### 5.1 트리거 = 성공한 unlock (유일한 합법적 순간)

재암호화에는 **PIN 평문과 니모닉 평문이 동시에** 필요하다. §1.2 표에서 그 조건을 만족하는
경로는 createWallet(신규 — 마이그레이션 불필요), unlock, verifyPassword(니모닉 없음),
changePassword, getMnemonic 뿐이고, 이 중 **모든 세션이 반드시 통과하는 관문은 unlock 하나다**
(verifyPassword/getMnemonic/changePassword 는 전부 unlock 이후에만 도달 가능한 화면에 있다 —
`MainApp.tsx:806` 잠금 시 LockScreen 단독 렌더). passkey 해제도 복호화된 PIN 을 동일한
`onUnlock` 으로 흘리므로 (`LockScreen.tsx:99-101`) 같은 관문을 지난다.

→ **쓰기 지점은 unlock 내부 단일 지점으로 고정한다.** verifyPassword/getMnemonic 은 버전
인지 읽기만 하고 절대 쓰지 않는다(읽기 경로에 쓰기를 심으면 §6 의 경합 분석을 전 경로로
확장해야 한다). 예외 하나: changePassword 는 지금도 레코드 전체를 재작성하므로
(`security.service.ts:133-140`) 자연스럽게 신버전으로 기록한다 — 이것은 "마이그레이션"이
아니라 "쓰기는 항상 현재 버전으로" 원칙이다. createWallet 도 동일.

### 5.2 kdfVersion 필드 (축 ③)

```ts
// secure-storage.port.ts
export interface StoredWallet {
  encryptedMnemonic: EncryptedData
  passwordHash: string
  passwordSalt: string
  publicKey: string
  createdAt: number
  /** KDF 파라미터 세대. 부재 = 1 (PBKDF2-SHA256 100k, 기존 레코드). 2 = 600k. */
  kdfVersion?: number
}
```

- **부재 = v1** — 기존 레코드는 재작성 없이 그대로 v1 로 해석된다 (스키마 마이그레이션 불필요).
- 버전→파라미터 맵은 core 서비스 층 소유 (`KDF_ITERATIONS = { 1: 100_000, 2: 600_000 }`,
  `CURRENT_KDF_VERSION = 2`). 어댑터(`EncryptionAdapter`)는 정책 없이 반복수를 인자로 받는
  실행자가 된다 — Encryption 포트 시그니처에 `iterations` 추가 (§9 파일 목록).
- **불변식: 한 레코드 안의 `passwordHash` 와 `encryptedMnemonic` 은 항상 같은 버전으로
  파생되어 있다.** 이를 보증하는 것은 "두 필드를 항상 한 레코드 쓰기로만 갱신한다"는 규칙이고
  (createWallet/changePassword/마이그레이션 셋 다 전체 레코드 단일 put), 그 규칙이 깨지는
  유일한 시나리오(구버전 changePassword 의 오염)는 §5.5 폴백이 치유한다.

### 5.3 흐름 — 상태도와 의사코드

```
                       ┌────────────────────────────────────────────┐
                       │ unlock(password)                           │
                       └────────────────────────────────────────────┘
                                        │ getWallet → { wallet, tag } | null
                        null ──────────▶ Err(NO_WALLET)   (half-wipe 구제 경로 불변, §7 F10)
                                        ▼
                       declared = wallet.kdfVersion ?? 1
                       verifyAgainstRecord(wallet, password)
                         = declared 버전으로 hash 비교 → 실패 시 나머지 알려진 버전 폴백(§5.5)
                                        │
                        불일치 ────────▶ Err(INVALID_PASSWORD)   (마이그레이션 절대 없음)
                                        ▼
                       decrypt(matchedVersion) → mnemonic → 키·시드 파생, 캐시 (기존과 동일)
                                        │
             matchedVersion == CURRENT  │  matchedVersion != CURRENT
             && declared == matched     │  || declared != matched (오염 치유)
                        │               ▼
                        │      ┌─ migrateRecord ──────────────────────────────┐
                        │      │ 1. encrypt(mnemonic, pin, 600k)  (~43ms)     │
                        │      │ 2. salt2 = randomHex(16)                     │
                        │      │    hash2 = hashPassword(pin, salt2, 600k)    │
                        │      │ 3. readback: decrypt(1의 결과) == mnemonic ? │ ← 자기 산출물 검증
                        │      │ 4. next = { ...wallet, 새 3필드,             │
                        │      │            kdfVersion: 2 }                   │
                        │      │ 5. storage.replaceWallet(next, tag)  [CAS]   │ ← §6.2
                        │      └──────┬───────────────┬───────────────────────┘
                        │        성공 │           실패/CAS miss │  ← 어느 쪽이든 unlock 결과 불변
                        │             ▼                        ▼
                        │      migrated = true          v1 유지, 다음 unlock 재시도
                        ▼             │                        │
                       Ok({ keys, bip39Seed, migrated }) ◀────┘
                                        │
                       (UI 층) migrated == true → broadcastSync('settings_changed')  ← §6.4
```

의사코드 (서비스 층):

```ts
async unlock(password): Result<UnlockResult, SecurityError> {
  const rec = await this.storage.getWallet()          // { wallet, tag } | null (§6.2 포트 변경)
  if (!rec) return Err(NO_WALLET)
  const { wallet, tag } = rec

  const match = await this.verifyAgainstRecord(wallet, password)   // §5.5
  if (!match) return Err(INVALID_PASSWORD)

  const mnemonic = await this.encryption.decrypt(
    wallet.encryptedMnemonic, password, KDF_ITERATIONS[match.version])
  // …키 파생·캐시: 기존 :86-91 그대로…

  let migrated = false
  const declared = wallet.kdfVersion ?? 1
  if (match.version !== CURRENT_KDF_VERSION || declared !== match.version) {
    try {
      migrated = await this.migrateRecord(wallet, tag, password, mnemonic)
    } catch (e) {
      console.error('[Security] KDF migration failed — retrying next unlock:', e)
      // 비치명: unlock 결과에 영향 없음. 레코드는 v1 온전 (§7 F3)
    }
  }
  return Ok({ keys, bip39Seed, migrated })
}
```

마이그레이션 실패가 unlock 을 실패시키지 않는 이유: 사용자는 정당한 PIN 으로 들어왔고 자금
접근이 우선이다. 실패해도 레코드는 v1 그대로이므로(§6.1 원자성) 보안이 **나빠지는** 것이
아니라 현행 유지일 뿐이며, 다음 unlock 이 자동 재시도한다. 이는 기존의 "인프라 실패를
INVALID_PASSWORD 로 뭉개지 않는다" 계약(`MainApp.tsx:530-537`, 커밋 2bf4c7e)과도 정합적이다 —
마이그레이션 실패는 어느 쪽 오류도 아니고 unlock 성공이다.

### 5.4 readback 검증 이 있는 이유 — 양방향 (두 리뷰 수렴 반영)

put 되는 암호문이 곧 **니모닉의 유일 사본**을 대체한다(구 레코드는 소멸). 재암호화 코드의
버그·플랫폼의 subtle 이상이 만든 깨진 암호문을 그대로 쓰면 지갑이 복구 불능이 된다(니모닉
백업 없는 사용자 기준). 600k 복호 1회(~43ms, 모바일 ~0.2초)로 "쓰기 전에 자기 산출물을
자기 파라미터로 열어 원문과 대조"하는 보험이다.

**대칭 보강 (가이드 MINOR-1 + 블라인드 MINOR-2 수렴):** readback 이 니모닉 암호문만 검증하면
두 종류의 배선 버그를 못 잡는다 — (a) 마이그레이션이 잘못된 반복수로 **자기일관되게** 암호화+
검증(가이드), (b) `hash2` 만 조용히 오산(블라인드). 둘 다 "v2 선언·내용 불일치" 레코드를 만들고,
§5.5 폴백이 매 unlock 재마이그레이션을 발화해 **수렴하지 않는 루프**(비파괴적이나 상시 지연+
console.error)가 된다. 따라서 readback 은 두 산출물을 **의도한 CURRENT 파라미터로 새로 파생한
키/해시**로 교차 검증한다:

1. `decrypt(newCiphertext, pin, KDF_ITERATIONS[CURRENT]) === mnemonic` (기존 — 니모닉 왕복)
2. `hashPassword(pin, salt2, KDF_ITERATIONS[CURRENT]) === hash2` (신설 — 검증자 왕복. 이미 계산한
   hash2 를 CURRENT 로 재산출해 비교하면 반복수 오배선을 즉석 검출)

둘 중 하나라도 불일치면 put 하지 않는다(F3 비치명 경로 — v1 유지, 다음 unlock 재시도). 이로써
"자기 파라미터로 자기 산출물을 여는" 맹점이 "**CURRENT 상수로 재파생**"으로 닫힌다.

**수렴 가드 (선택, 미해결 질문 #3 연계):** 위 대칭 검증이 오배선 레코드의 *생성*을 막으므로
루프의 근원이 제거된다. 그럼에도 이미 존재하는 오염 레코드(F7)의 재마이그레이션은 정상 1회로
수렴(치유 후 v2 정직 레코드)하며, 병리적 지속-실패는 F3 로그로 관측된다.

### 5.5 verifyAgainstRecord — 선언 버전 우선 + 폴백 (자가 치유)

```ts
/** 반환: 실제로 일치한 버전. declared 우선 시도, 실패 시 나머지 알려진 버전 순회.
 *  미지의 declared(미래 버전 레코드)는 알려진 버전 전수 폴백으로 강등 —
 *  KDF_ITERATIONS[미지] 참조로 깨지지 않게 KNOWN 집합으로 한정한다. */
private async verifyAgainstRecord(wallet, password): Promise<{ version: number } | null> {
  const declared = wallet.kdfVersion ?? 1
  const order = KNOWN_VERSIONS.includes(declared)
    ? [declared, ...KNOWN_VERSIONS.filter(v => v !== declared)]
    : [...KNOWN_VERSIONS].reverse()          // 미지 버전: 최신 우선 전수 시도
  for (const v of order) {
    const h = await this.encryption.hashPassword(password, wallet.passwordSalt, KDF_ITERATIONS[v])
    if (constantTimeEqual(h, wallet.passwordHash)) return { version: v }
  }
  return null
}
```

부수 효과: **미래의 같은 상황을 미리 완화한다** — 훗날 v3 이 배포된 뒤 v2 앱(이번 릴리스)이
v3 레코드를 만나면, 미지-버전 분기가 알려진 버전을 전수 시도한 뒤 INVALID_PASSWORD 로
수렴한다(§6.4 F11 과 동일 상한, 크래시 없음). 단 v3 앱이 이 마이그레이션을 재수행하는 것은
막지 못하며 그럴 필요도 없다 — 각 세대는 자기 CURRENT 로만 쓴다.

이 폴백이 방어하는 실재 시나리오 (§7 F7, 실코드로 추적): 구버전 번들의 `changePassword` 는
`{ ...wallet, encryptedMnemonic, passwordHash, passwordSalt }` 스프레드로 레코드를 재작성한다
(`security.service.ts:133-138`) — **모르는 필드 `kdfVersion: 2` 는 스프레드에 살아남고, 내용물은
100k 로 다시 쓰인다.** 결과는 "v2 라고 선언하지만 내용은 v1" 인 오염 레코드이고, 선언만 믿는
신버전은 정당한 PIN 을 영원히 거부하게 된다(복구 불능급 UX). 폴백은 이를 자동 치유한다:
declared=2 실패 → v1 성공 → `declared !== match.version` 조건이 재마이그레이션을 발화.

보안 영향 분석 — 폴백은 공격자를 돕지 않는다: 오프라인 공격자(T3)는 우리 검증 절차가 아니라
**레코드 내용물**을 공격한다. 정직한 v2 레코드의 내용물은 600k 로만 파생돼 있으므로 공격자가
100k 로 후보를 돌려봤자 일치가 나오지 않는다(SHA-256 출력 충돌 확률 2^-256 수준). 폴백의
비용은 오답 PIN 1회당 PBKDF2 1회 추가(v2 레코드 기준 +7ms/이 기기)뿐이며, 온라인 공격자(T1)는
어차피 5회/15분 잠금에 막힌다. 상수시간 비교(`constantTimeEqual`)는 각 시도에 그대로 쓴다.

### 5.6 verifyPassword / getMnemonic / changePassword 의 버전 인지화

셋 다 현재 100k 를 하드코딩 경유(`hashPassword` 공유 상수)하므로, `verifyAgainstRecord`
헬퍼를 공유해 **읽기만** 버전 인지로 바꾼다 (쓰기 없음 — §5.1 단일 쓰기 지점 원칙).
changePassword 는 검증은 헬퍼로, 기록은 항상 `CURRENT_KDF_VERSION` 으로 한다 — v1 레코드
사용자가 PIN 을 바꾸면 그 시점에 자연 승급된다.

### 5.7 검토 후 기각한 대안 (리뷰 선답변)

- **HKDF 통합 파생 (PBKDF2 1회 → HKDF 로 검증자/암호화 키 분기 — unlock 지연 절반)**:
  성능상 매력적이지만 기각. (a) §3.2 실측상 2×600k = 최악 보정 0.43초로 이미 예산 내 —
  최적화의 필요 근거가 없다. (b) 검증자 파생 구조 자체가 바뀌어 v1 과의 개념 대칭
  (같은 구조, 반복수만 상이)이 깨지고, 폴백 검증(§5.5)·핀 고정 벡터(§8-1)의 서사가 이중화된다.
  (c) v3(Argon2id 재평가 시점)에서 어차피 파생 구조를 다시 논의한다 — 그때 함께.
- **unlock 반환 후 백그라운드 마이그레이션 (체감 지연 0)**: 기각. unlock 반환 후의 쓰기는
  자동잠금이 arm 된 구간·부트스트랩(레지스트리 생성, `MainApp.tsx:551-568`)과 병행하게 되어
  §6.3 의 "마이그레이션 중 자동잠금 발화 불가" 판정이 무너지고 경합 분석 표면이 커진다.
  절약되는 것은 평생 1회의 ~0.7초(모바일 최악 추정)뿐 — 단순성의 손해가 더 크다.
- **임시 이중 레코드(신규 키 기록 후 스왑)**: §6.1 에서 기각 — IDB 단일 put 이 이미 원자적이라
  이중 레코드는 "공존 중간 상태 + 정리 실패 잔반"만 새로 만든다.
- **v1 해시 병존 기록 (다운그레이드 호환)**: §6.4 R3 에서 금지 — 최약점 잔존으로 설계 무의미화.

---

## 6. 원자성과 경합 (축 ③·④)

### 6.1 실코드 판정: 단일 put 은 자연 원자적 — 두 레코드 불필요

`saveWallet` 은 StoredWallet JSON 전체를 기기 키로 암호화해 **단일 키 `'current'` 에 대한
단일 readwrite 트랜잭션의 단일 put** 으로 기록한다 (`secure-storage.adapter.ts:35-48,111-120`).
IndexedDB 트랜잭션은 all-or-nothing 커밋이다 (W3C IndexedDB 스펙 — "changes are either
completely applied or completely discarded": https://www.w3.org/TR/IndexedDB/#transaction-construct).
따라서:

- put 커밋 전 크래시 → 구 레코드(v1) 온전 → 다음 unlock 이 v1 로 정상 해제 후 재시도 (§7 F1)
- put 커밋 후 크래시 → 신 레코드(v2) 완전 (§7 F2)
- **찢어진 중간 상태는 물리적으로 없다.** passwordHash 와 encryptedMnemonic 이 한 JSON 안에
  있으므로 §5.2 불변식도 같은 원자성이 보증한다.

→ 계획 문면의 "신규 기록 완전 저장 후 구기록 교체"는 이 구조에서 **"메모리에서 신 레코드를
완성·검증(§5.4)한 뒤, 교체 자체는 단일 put"** 으로 충족된다. 임시 이중 레코드(신규 키에 쓰고
스왑)는 오히려 "두 레코드가 공존하는 중간 상태 + 정리 실패 잔반" 문제를 새로 만들므로 기각.

### 6.2 그러나 "무엇 위에 put 하는가"는 원자적이지 않다 — CAS 도입

단일 put 은 찢어짐은 막지만 **덮어쓰기의 전제 확인**은 못 한다. 마이그레이션은 unlock 을
쓰기 주체로 만들므로(§1.2 관찰 2) 다음 창이 열린다:

- **로그아웃 부활 경합** (§7 F5): 탭 A(잠금 화면)가 unlock+마이그레이션 중(수백 ms 의 crypto
  await), 탭 B 가 로그아웃 소거를 완주(`logout.ts:61-106` — ④ `deleteWallet` 이 마지막 가멸
  단계)한 직후, 탭 A 의 put 이 늦게 착지하면 **소거된 니모닉 레코드가 부활**한다. 이는
  wipeAccountData 의 핵심 불변식("지갑 레코드는 마지막에 죽는다, 죽은 뒤 데이터는 없다" —
  `logout.ts:8-14`)을 뒤집어 "레코드는 있는데 데이터는 없는" 반쪽 상태 + 로그아웃 약속 위반
  (기기에 니모닉 잔존)을 만든다. broadcastSync('logout') 의 reload 가 탭 A 를 죽이지만,
  브로드캐스트 전달과 put 착지의 순서는 보증이 없다 — 결정론적 차단이 필요하다.

**설계: 태그 기반 조건부 교체 (compare-and-swap).**

외곽 레코드의 `iv` 는 saveWallet 마다 새로 뽑는 12바이트 난수다 (`secure-storage.adapter.ts:37`)
— **저장 세대 태그로 그대로 쓸 수 있다.** 포트 변경:

```ts
// secure-storage.port.ts
export interface SecureStorage {
  /** wallet 과 함께 저장 세대 태그(opaque)를 반환 — replaceWallet 의 전제 조건에 사용 */
  getWallet(): Promise<{ wallet: StoredWallet; tag: string } | null>
  saveWallet(wallet: StoredWallet): Promise<void>
  /** tag 가 현재 레코드와 일치할 때만 교체. 불일치·레코드 부재 → false (no-op). */
  replaceWallet(next: StoredWallet, expectedTag: string): Promise<boolean>
  deleteWallet(): Promise<void>
}
```

어댑터 구현의 핵심 제약 — **IDB 트랜잭션 내부에서 crypto.subtle 을 await 할 수 없다.**
IDB 트랜잭션은 대기 중 요청이 없는 채로 제어가 이벤트 루프로 돌아가면 자동 커밋되고, 이후
요청은 `TransactionInactiveError` 가 된다 (MDN IDBTransaction — "An active transaction will
automatically commit when all outstanding requests have been satisfied":
https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction). 비-IDB promise(crypto.subtle)
를 트랜잭션 안에서 기다리는 설계는 성립하지 않는다. 따라서:

1. 암호화(신 레코드의 EncryptedRecord 생성)는 **트랜잭션 밖에서** 완료한다.
2. 하나의 readwrite 트랜잭션 안에서: `get('current')` → onsuccess 핸들러(동일 태스크)에서
   `현재 iv hex == expectedTag` 를 **동기 비교** → 일치 시 같은 핸들러에서 `put`, 불일치·부재 시
   put 없이 종료(false). get 과 put 이 같은 트랜잭션이므로 사이에 다른 쓰기가 끼어들 수 없다.

이 CAS 로 정리되는 경합 (§7 표):

- 로그아웃 경합: 소거가 먼저면 get=null → no-op (부활 불가). 마이그레이션 put 이 먼저면
  이후 소거의 delete 가 신 레코드도 지운다 — 어느 순서든 최종 상태 = 소거 완료.
- 양탭 동시 unlock+마이그레이션: 후발 탭은 tag 불일치 → no-op. 선발 탭의 v2 레코드가
  확정된다. 어느 탭의 레코드든 동일 PIN 으로 유효하므로 last-wins 도 정합이지만, CAS 는
  불필요한 이중 쓰기까지 없앤다.
- CAS 실패는 예외가 아니라 false — 마이그레이션 스킵으로 처리 (§5.3 비치명 경로).

### 6.3 자동잠금 상호작용 (축 ④) — 실코드 판정: 간섭 없음

1. **자동잠금은 마이그레이션 중 발화할 수 없다.** use-auto-lock 의 감시 effect 는
   `isLocked` 동안 비활성이다 (`use-auto-lock.ts:38` — `if (!enabled || isLocked || …) return`).
   마이그레이션은 unlock() 반환 **전**에 실행되고, `setLocked(false)` 는 unlock 반환 후에야
   호출된다 (`MainApp.tsx:546-562`). 즉 마이그레이션 전 구간에서 자동잠금 훅은 arm 되어 있지
   않다.
2. 발화했다 가정해도(방어적 분석): `handleAutoLock` → `security.lock()` 은 **메모리 캐시
   소거뿐, 스토리지 IO 가 없다** (`security.service.ts:193-197`, `use-security-handlers.ts:50-53`).
   마이그레이션의 지역 변수(password/mnemonic)는 함수 스코프라 영향받지 않고, 레코드 쓰기와도
   무간섭이다.
3. 마이그레이션이 세션 비밀의 수명을 늘리지도 않는다 — unlock 이 이미 니모닉을 SeedCache 에
   캐시하는 구조(`security.service.ts:91`)이며 마이그레이션은 그 지역 참조만 쓴다.

### 6.4 다운그레이드 — 구버전 앱 × v2 레코드 (축 ③ 후반)

**실코드 추적 (구버전 = 현행 HEAD 코드가 곧 "구버전"이 된다):**

1. 구 `unlock` 은 `kdfVersion` 을 모른다 — JSON 파싱된 레코드에서 모르는 필드는 무해하게
   무시되고, `hashPassword` 는 무조건 100k 로 돈다 (`encryption.adapter.ts:10,63`).
2. v2 해시(600k)와 불일치 → `Err(INVALID_PASSWORD)` (`security.service.ts:80-83`).
3. `handleUnlock` 은 INVALID_PASSWORD 를 `false` 로 변환 (`MainApp.tsx:534-535`).
4. LockScreen 이 **오답으로 계수**: "PIN 이 틀렸습니다(남은 횟수 n)" → 5회 → **15분 잠금**,
   잠금 상태는 localStorage `'lockout'` 에 저장되어 **같은 프로파일의 모든 탭이 공유**한다
   (`LockScreen.tsx:146-166,71-82`).
5. passkey 자동 해제도 같은 운명 — 복호화된 (정답) PIN 이 `onUnlock` 에서 false 를 받고,
   자동 시도는 무음 실패한다 (`LockScreen.tsx:92-119`, silent=true 경로). 계수는 하지 않는다
   (`handlePasskeyAuth` 에 failedAttempts 증가 없음).

**결과의 상한 — 파괴는 없다:** 잠금 화면에는 실패 누적 시 지갑을 소거하는 경로가 존재하지
않는다(LockScreen 전수 — 소거는 Settings 로그아웃 뿐이고 그곳은 unlock 후에만 도달).
니모닉·자금은 무손상이며, 증상은 "정답 PIN 이 오답으로 표시 + 15분 잠금 루프"다.

**이 시나리오가 실제로 열리는 창 (실배포 체제 추적):** PWA 는 `registerType: 'prompt'` +
`clientsClaim: true` (`vite.config.ts:135,177`). 업데이트 수락 후 새 SW 가 클라이언트를
claim 하지만 **이미 로드된 탭은 reload 전까지 구 번들 JS 로 계속 돈다.** 즉 "탭 B 가 새
번들로 마이그레이션 완료 → 탭 A(구 번들, 잠금 화면)가 정답 PIN 거부"가 표준 경로다.
별도 기기·별도 프로파일은 IDB 를 공유하지 않으므로 해당 없음.

**graceful 실패 요건 (설계 포함분):**

- R1. **마이그레이션 직후 타 탭 강제 reload + lockout 소거**: unlock 이 `migrated: true` 를
  반환하면 (§5.3), UI 층(MainApp handleUnlock)이 `broadcastSync('settings_changed')` 를 쏜다.
  이 타입에 대한 `window.location.reload()` 반응은 **저장소 초기 커밋(ae1564a, 2026-02-19)
  부터 현행(`use-cross-tab-sync.ts:23-26`)까지 전 이력에서 확인**되므로(git 추적) 배포된
  어떤 구 번들 탭도 즉시 새 번들로 재기동된다(새 SW 가 claim 중).
  **정정 (블라인드 리뷰 MAJOR-1): reload 만으로는 이미 발동된 15분 잠금이 풀리지 않는다.**
  구 탭이 정답 PIN 을 오답 계수해 `localStorage['lockout']` 을 이미 기록했다면, 새 번들의
  LockScreen 은 마운트마다 그 값을 **재수화**해 잠금 상태로 재진입한다
  (`LockScreen.tsx:71-82` → `isLockedOut` 가 `handleSubmit`·auto-submit effect 게이트).
  즉 "올바른 번들 도달"이 "잠금 해제"를 뜻하지 않는다. 따라서 마이그레이션 성공 경로는
  **broadcast 와 함께 `localStorage.removeItem('lockout')` 을 수행**한다 — 성공 unlock 은
  이미 PIN 지식을 증명하므로 그 시점의 lockout 은 다운그레이드 버그가 만든 거짓 잠금이거나
  무의미하다(정당 사용자는 방금 들어왔다). 이로써 R1 이 진짜 즉시 복구가 된다. (§9 item 7 에 반영)
  broadcast 를 core 서비스가 아닌 UI 층에서 쏘는 이유: `utils/cross-tab-sync` 는 브라우저
  프리미티브로 core 가 import 하면 안 되는 층이다 (헥사고날 — 기존 계약 유지).
  신설 메시지 타입('wallet_migrated' 등)은 기각 — 구 번들이 모르는 타입은 무시되므로
  (`use-cross-tab-sync.ts:19-27` if/else 구조) 정작 reload 가 필요한 구 탭에 안 통한다.
- R2. **오염 자가 치유**: R1 의 창(브로드캐스트 전달 전)에서 구 번들 탭이 changePassword 를
  실행해 레코드를 오염시켜도 §5.5 폴백이 다음 unlock 에서 치유한다.
- R3. **잔존 수용분 (정정)**: BroadcastChannel 미지원/실패 환경은 broadcast 가 조용히 무시된다
  (`cross-tab-sync.ts:24-31,35-44` null/catch). 이 경우 구 탭의 wrongPin+15분 잠금이 실제로
  발생할 수 있다 — **비파괴적이지만, reload 로는 풀리지 않고 15분 타이머 만료(또는 R1 의
  lockout 소거가 전달될 때)로만 해소된다** (블라인드 MAJOR-1 정정 — 이전 문면의 "탭 reload 로
  자연 해소"는 `logout.ts:33` 이 lockout 을 유지 삭제 대상에서 제외하고 LockScreen 이 재수화하므로
  사실과 다르다). 최악 상한 = 정답 PIN 이 최대 15분 거부, 자금·니모닉 무손상. 진짜 앱
  다운그레이드(구 빌드 재설치)도 동일 증상·동일 상한이며 broadcast 도달 불가라 15분 만료가
  유일 해소 — 복구는 앱 업데이트다. 이를 위한 레코드 이중 기록(v1 해시 병존)은 **금지**한다:
  v1 해시를 남기는 순간 §2.2 최약점이 그대로 잔존해 이 설계 전체가 무의미해진다.

---

## 7. 실패 모드 표

| # | 시나리오 | 코드/설계 근거 | 결과 | 복구 |
|---|----------|---------------|------|------|
| F1 | 마이그레이션 crypto 단계 중 크래시/탭 종료 (put 전) | put 이 유일한 쓰기 (§6.1) | 레코드 v1 온전, 캐시는 휘발 | 다음 unlock 정상 해제 + 자동 재시도 |
| F2 | put 커밋 직후 크래시 | IDB 트랜잭션 원자성 (§6.1) | v2 레코드 완전 (두 필드 동조 — §5.2 불변식) | 불필요 — 다음 unlock 은 v2 고속 경로 |
| F3 | 재암호화/해시/readback 실패 (subtle 예외, 검증 불일치) | §5.3 try/catch 비치명 + §5.4 | unlock 은 성공, 레코드 v1 유지, console.error | 다음 unlock 자동 재시도 |
| F4 | replaceWallet IDB 쓰기 실패 (quota 등) | 동일 catch 경로 | 동상 | 동상 |
| F5 | 마이그레이션 vs 타 탭 로그아웃 소거 경합 | CAS: 소거 선행 → get=null → no-op (§6.2) | 부활 없음 — 로그아웃 불변식(`logout.ts:8-14`) 보존 | 불필요 (해당 탭은 'logout' broadcast 로 reload) |
| F6 | 양탭 동시 unlock+마이그레이션 | CAS: 후발 tag 불일치 → no-op (§6.2) | 선발 탭의 v2 확정, 양쪽 unlock 모두 성공 | 불필요 |
| F7 | 구 번들 changePassword 가 v2 레코드 오염 (kdfVersion 잔존 + 100k 내용) | 스프레드 실추적 `security.service.ts:133-138` + §5.5 | 신 번들 unlock: 선언 600k 실패 → 폴백 100k 성공 → 재마이그레이션 (자가 치유) | 자동 |
| F8 | passkey 경로와의 상호작용 | PIN 이 동일 unlock 관문 통과 (`LockScreen.tsx:99-101`); passkey 저장물은 kdfVersion 무관 (§4.2) | 마이그레이션 정상 작동, passkey 재등록 불필요 | 불필요 |
| F9 | 자동잠금 발화 | 마이그레이션 중 arm 자체가 안 됨 + lock() 은 메모리 전용 (§6.3) | 간섭 없음 | 불필요 |
| F10 | half-wipe 상태 (레코드 부재) 기기 | getWallet=null → NO_WALLET — 마이그레이션 코드 도달 불가; CAS 도 부재 시 no-op | NO_WALLET 구제 경로(`use-security-handlers.ts:82-93`) 그대로 — 소거 재개 가능 | 기존 구제 경로 |
| F11 | 구 번들 탭/구 앱 × v2 레코드 (다운그레이드) | §6.4 추적 (블라인드 MAJOR-1 정정) | 정답 PIN 이 wrongPin 표시, 5회 → 15분 잠금(`localStorage['lockout']`, 탭 간 공유·reload 재수화). **비파괴 — 소거 경로 없음** | R1 broadcast 가 reload **+ lockout 소거**를 전달하면 즉시 복구; broadcast 미도달 시 **15분 타이머 만료가 유일 해소**(reload 로는 안 풀림), 앱 다운그레이드는 앱 업데이트 |
| F12 | 마이그레이션 도중 사용자가 로그아웃 시도 (동일 탭) | 잠금 시 LockScreen 단독 조기 반환 (`MainApp.tsx:804-807` `if (isLocked) return <LockScreen…>`) — unlock 반환 전 Settings 도달 불가 | 경합 자체가 없음 | 불필요 |
| F13 | 첫 upgrade-후 unlock 의 마이그레이션 지연 (가이드 MINOR-3) | 마이그레이션이 `setLocked(false)` 전 동기 실행(§5.7 백그라운드 기각) → unlock 반환 후 createBootstrap(`MainApp.tsx:551-568`)과 체감 지연 합산 | 첫 unlock 크리티컬 패스에 ~0.13s(이 기기)/~0.5–0.7s(모바일 추정) 가산, 평생 1회 | LockScreen `isLoading` 흡수 — >1.5s 실측 시 "보안 업그레이드 중" 표시 (부록 B #2) |

---

## 8. 테스트 계획

기존 커버리지: `security.service.test.ts`(unlock/changePassword/verifyPassword/getMnemonic/
lock/deleteWallet), `encryption.adapter.test.ts`, `LockScreen.lockout.test.tsx`,
`use-security-handlers.test.tsx`, `logout.test.ts` — 전부 통과 유지가 기본 게이트.

신설/보강 (구현 PR 의 수용 기준):

1. **encryption.adapter** — iterations 인자화:
   - 같은 입력·다른 반복수 → 다른 hash/키 (v1·v2 분리 실증)
   - **v1 핀 고정 벡터**: 100k 로 생성해 둔 (password, saltHex, hash, encryptedMnemonic)
     고정 세트가 영원히 검증/복호 성공 — v1 의미(§1.3 salt 특이점 포함) 드리프트 방지 회귀선
2. **security.service** — 마이그레이션 계약:
   - v1 레코드 + 정답 PIN unlock → replaceWallet 호출·kdfVersion=2·두 필드 모두 재파생·
     같은 PIN 으로 재unlock 성공·니모닉 동일
   - v2 레코드 unlock → 쓰기 0회 (고속 경로)
   - 오답 PIN → 마이그레이션 절대 미발화 (INVALID_PASSWORD 만)
   - replaceWallet 이 throw/false → unlock 은 여전히 Ok, 레코드 불변, migrated=false
   - readback 불일치(암호화 스텁 조작) → put 미도달
   - **오염 치유**: kdfVersion=2 + 100k 내용물 레코드 → 폴백 매치 → 재마이그레이션 (F7)
   - createWallet/changePassword 가 kdfVersion=CURRENT 로 기록; v1 레코드의 changePassword 는
     검증(100k)·기록(600k) 교차 동작
   - verifyPassword/getMnemonic 이 v1·v2 레코드 양쪽에서 정답/오답 정확 판정 + 쓰기 0회
3. **secure-storage.adapter** (fake-indexeddb):
   - getWallet 태그 안정성(같은 레코드 = 같은 태그), saveWallet 후 태그 변경
   - replaceWallet: 태그 일치 → 교체+true / 불일치 → 불변+false / 부재 → false (F5·F6 계약)
   - CAS 트랜잭션 단일성: get 과 put 사이 외부 put 이 끼어든 시나리오(태그 불일치)로 검증
4. **UI 계약 불변**: LockScreen.lockout·use-security-handlers 기존 테스트 무수정 통과
   (마이그레이션은 UI 계약에 불가시) + handleUnlock 이 migrated=true 에 broadcast 1회 (신규)
5. **수동/실기기 (출시 게이트)**: 중저가 Android 실기기 1대에서 v1→v2 마이그레이션 unlock
   체감·시간 기록 (§3.2 보정 계수 검증, >1.5초면 UX 재논의 — 미해결 질문 #2)

---

## 9. 구현 작업 목록 (예상)

| # | 파일 | 변경 | 크기 |
|---|------|------|------|
| 1 | `src/core/ports/driven/encryption.port.ts` | encrypt/decrypt/hashPassword 에 `iterations: number` 인자 추가 | S |
| 2 | `src/adapters/crypto/encryption.adapter.ts` | 상수 제거, 인자 수용 (정책 무소유 실행자화) | S |
| 3 | `src/core/ports/driven/secure-storage.port.ts` | `kdfVersion?`, **신설 `getWalletWithTag()`**(기존 `getWallet()` 시그니처 불변 — 블라인드 NIT-1: 태그는 unlock/마이그레이션만 필요하므로 5 사이트 파급 회피), `replaceWallet(next, tag)` | S |
| 4 | `src/adapters/storage/secure-storage.adapter.ts` | 태그(iv hex) 반출, CAS replaceWallet (단일 tx get→동기비교→put — **현행 dbGet/dbPut 이 각자 tx 를 열어 재사용 불가, 신규 tx 헬퍼 필요**) | M |
| 5 | `src/core/services/security.service.ts` | KDF_ITERATIONS 맵 + CURRENT, verifyAgainstRecord 폴백, unlock 마이그레이션 블록(비치명, **양방향 readback §5.4**), 전 메서드 버전 인지화, UnlockResult.migrated | **M–L** (가이드 MINOR-2) |
| 6 | `src/core/ports/driving/security.usecase.ts` | UnlockResult 에 `migrated?: boolean` | S |
| 7 | `src/MainApp.tsx` handleUnlock | migrated → `broadcastSync('settings_changed')` **+ `localStorage.removeItem('lockout')`** (R1). **두 성공 반환 경로 모두**(:546-549 fast/re-unlock, :572 bootstrap) — 블라인드 MINOR-1. 체크를 반환 전 공통 지점으로 hoist 권장 | S |
| 8 | `src/ui/services/passkey.ts` | §4.2 동결 근거 주석 1줄 | S |
| 9 | 테스트 (§8 의 1–4 + F11 lockout 소거 + 양방향 readback) | 신설·보강 | M-L |

프로덕션 diff 어림 **200–300줄**(대칭 readback·CAS tx 헬퍼·lockout 소거 반영 상향) + 테스트
350–450줄. i18n 변경 없음(마이그레이션은 침묵 — 실패 시에도 기존 `lock.errorOccurred` 계열
밖의 신규 문자열 불필요). 자금 인접 변경이므로 R2-D 게이트(가이드+블라인드 이중 리뷰) 후 커밋.

## 10. 명시적 비범위

- passkey PRF 경로의 반복수 변경 (§4.2 판정 — 동결)
- Argon2id 도입 (§3.4 — v3 후보로 이월, PIN 정책 강화와 묶어 재평가)
- PIN 길이/문자 정책 변경 (6자리 숫자 유지 — 별도 제품 결정)
- lockout 정책(5회/15분) 변경, LockScreen UX 변경
- 외곽 기기 키 층(zappi-secure 이중 암호화) 변경
- 구버전 번들의 소급 수정 (배포된 코드 — 불가능, §6.4 R3 수용으로 대체)
- hashPassword salt 의미 정규화 (§1.3 — v1/v2 동결)
- POS 키 반출 UX (todo 별항 — 소유자 결정 대기)
- 니모닉 백업/복원 포맷, coco 자금 DB — 무접촉

---

## 부록 A. 벤치마크 원기록

- 환경: Apple M5 (arm64, macOS 25.5.0), Node v25.9.0 (`globalThis.crypto.subtle`, OpenSSL 네이티브)
- 방법: `subtle.deriveBits({name:'PBKDF2', hash:'SHA-256', salt:16B, iterations:N}, key, 256)`,
  importKey 1회 재사용, warmup 2회 + 본측정 7회 중앙값 (min/max 병기)

```
   100000 iters: median 7.0ms  (min 6.9 / max 7.2)
   300000 iters: median 21.1ms (min 20.9 / max 21.2)
   600000 iters: median 42.8ms (min 42.3 / max 44.9)
  1000000 iters: median 71.2ms (min 70.7 / max 71.7)

unlock 모델 (PBKDF2 2회 = hash 검증 + deriveKey):
  현행 v1 (2×100k): 14ms   /  목표 v2 (2×600k): 86ms
  마이그레이션 unlock (2×100k + 4×600k — 구현 확정): 186ms
모바일 보정 ×3/×5 [추정]: v2 86→257/428ms, 마이그레이션 186→556/926ms
```

- 한계: 단일 기기·단일 엔진. 브라우저(BoringSSL/CommonCrypto)와는 동급 네이티브지만 동일치
  않음. 모바일 보정은 마진이며 §8-5 실기기 게이트로 검증한다.

## 부록 B. 미해결 질문

1. **모바일 실기기 수치 부재** — ×3~5 는 마진. 출시 게이트에 중저가 Android 1대 실측 포함 (§8-5).
2. **마이그레이션 UX 노출 여부** — 침묵 권고(최악 추정 ~0.7초). 실기기에서 1.5초 초과 시
   "보안 업그레이드 중" 표시 여부를 소유자 결정에 회부.
3. **폴백 verify 의 상시 유지 vs 한시 유지** — F7 오염은 구 번들 소멸 후 불가능해진다.
   폴백을 영구 유지할지(코드 단순) v3 도입 시 정리할지 구현 리뷰에서 재확인.
4. **OWASP/생태계 수치의 시점 고정** — 부록 C 의 출처 확인 일자를 문서에 박제. 권고치가
   변하면 kdfVersion 레지스트리에 v3 을 추가하는 것이 이 설계의 갱신 경로다.

## 부록 C. 외부 근거 (확인 일자: 2026-07-07 — 전 항목 원문/원자료 대조)

### C-1. OWASP Password Storage Cheat Sheet (현행 원문 검증)

- URL: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
  (raw: https://raw.githubusercontent.com/OWASP/CheatSheetSeries/master/cheatsheets/Password_Storage_Cheat_Sheet.md 대조)
- 1순위 권고 원문: "Use Argon2id with a minimum configuration of 19 MiB of memory, an
  iteration count of 2, and 1 degree of parallelism." (동등 구성 표: m=46MiB/t=1/p=1 등)
- **PBKDF2-HMAC-SHA256: 600,000 회** (본 설계 §3.3 의 앵커). SHA512: 220,000. SHA1(레거시 전용): 1,400,000.
- FIPS 조항: "If FIPS-140 compliance is required, use PBKDF2 with a work factor of 600,000
  or more and set with an internal hash function of HMAC-SHA-256."

### C-2. 브라우저 Argon2 표준화 상태

- WebCrypto `deriveBits/deriveKey` 지원 알고리즘 = ECDH, HKDF, PBKDF2, X25519 (Argon2 없음):
  https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveBits
- WICG "Modern Algorithms in the Web Cryptography API" 에 Argon2 포함 — 단 "not a W3C
  Standard nor on the W3C Standards Track": https://wicg.github.io/webcrypto-modern-algos/
- Chromium Intent to Experiment (2026-06-17, Chrome 151–154 오리진 트라이얼) 은 ML-KEM/
  ML-DSA/ChaCha20-Poly1305/X-Wing 만 — **Argon2 제외**:
  http://www.mail-archive.com/blink-dev@chromium.org/msg16785.html
- Mozilla 표준 입장: neutral (2025-08 issue #1282):
  https://github.com/mozilla/standards-positions/issues/1282
- WebKit/Safari: 공개 신호 미확인 (UNCONFIRMED).

### C-3. WASM/JS 라이브러리 실사 (npm tarball 바이트 실측 포함)

| 라이브러리 | Argon2 | 크기 (실측) | 정비 상태 | WASM 배포 방식 |
|-----------|--------|------------|-----------|----------------|
| argon2-browser 1.18.0 | O | js 4.3KB gz + wasm 11.5KB gz (분리) / 번들 20.5KB gz | **최종 릴리스 2021-06-05 — 사실상 휴면** (GitHub 최종 push 2023-03) | 분리 .wasm fetch 또는 base64 번들 |
| hash-wasm 4.12.0 | O | argon2 모듈 **11.6KB gz 실측** (전체 미트리셰이킹 시 77.7KB gz) | 최종 릴리스 2024-11-19, 활성 | **base64 인라인 — 별도 fetch/SW 처리 불요** |
| @noble/hashes 2.2.0 | O (순수 JS) | 전체 22KB gz | 활성 (2026-04 릴리스) | WASM 아님. 관리자 자체 경고: "Argon2 can't be fast in JS … brute-forcing attackers have bigger advantage"; 자체 벤치 argon2id t=1/m=256MB = **2,881ms** (WASM 동일 파라미터 ~383–391ms 의 ~7배) |

- 출처: https://registry.npmjs.org/argon2-browser · https://github.com/antelle/argon2-browser ·
  https://registry.npmjs.org/hash-wasm · https://github.com/Daninet/hash-wasm ·
  https://registry.npmjs.org/@noble/hashes · https://github.com/paulmillr/noble-hashes
- WASM ≈ 네이티브 −6~8% (m=256MiB: 네이티브 362.85ms vs hash-wasm 383.57ms vs argon2ian
  391.22ms, Ryzen 5850U/V8): https://lobste.rs/s/4q7nyv/argon2ian_argon2_hash_wasm_for_evergreen

### C-4. iOS/모바일 WASM 메모리 실태

- iOS Safari 탭에서 문서화된 실패는 **수백 MB 급**부터: maximum 2048MB 요청 즉시 OOM
  (https://github.com/godotengine/godot/issues/70621), ~300MB 초과 불안정 보고
  (https://github.com/WebAssembly/design/issues/1397), reload 시 이전 인스턴스 메모리 미회수
  (https://github.com/emscripten-core/emscripten/issues/19374).
- "64 MiB 한계" 통념의 실체 = iOS **앱 확장(autofill) 메모리 쿼터**: Bitwarden 문서
  (https://bitwarden.com/help/kdf-algorithms/), KeePassXC 128MB 즉시 초과 사례
  (https://github.com/keepassxreboot/keepassxc/issues/3550).
- OWASP 급(19–46MiB) 할당이 iOS Safari 탭/PWA 에서 실패한 공개 사례: 미발견 (UNCONFIRMED
  안전 — 도입 시 실기기 검증 필요는 유지).

### C-5. 지갑 선례

- **MetaMask**: 역사적 기본값 10,000회 (hashcat 크래킹 논의의 대상이었음 —
  https://github.com/hashcat/hashcat/issues/2818) → @metamask/browser-passworder v4.2.0
  (2023-11-13) 에서 KDF 구성 가능화 → **확장 현행 소스가 `encryptorFactory(600_000)` 구성**
  (main, 2026-07 검증): https://github.com/MetaMask/metamask-extension ·
  https://github.com/MetaMask/browser-passworder/releases. 실전 vault 의
  `iterations: 600000` 확인: https://github.com/hashcat/hashcat/issues/4022 (동 스레드가
  구 vault 는 자동 재암호화되지 않음을 보고 — 커뮤니티 보고 수준).
- **Bitwarden**: PBKDF2 기본·최소 600,000 ("In the 2026.2.1 release, Bitwarden increased
  the minimum number of PBKDF2 KDF iterations to the default level, 600,000"), Argon2id
  기본 32MiB/t=6/p=4, Argon2 는 WASM 필수: https://bitwarden.com/help/kdf-algorithms/ ·
  https://community.bitwarden.com/t/-/57466

### C-6. 성능 방증 (ballpark — 출처 신뢰도 명시)

- PBKDF2-SHA256 600k: Node ~237ms 사례 (기계 상이 — https://github.com/oven-sh/bun/issues/11703);
  **Snapdragon 730: 210ms, Raspberry Pi 4: 490ms** — 2026 실무 가이드
  (https://guptadeepak.com/the-complete-guide-to-password-hashing-argon2-vs-bcrypt-vs-scrypt-vs-pbkdf2-2026/),
  in-browser 여부 미명시 **[ballpark 전용 — §3.2 는 이를 보정 계수의 방증으로만 사용]**.
- Argon2id 19MiB/t=2/p=1 급의 명명된 모바일 기기 in-browser 정밀 실측: 공개물 미발견
  (UNCONFIRMED) — §3.4 가 성능을 기각 사유로 쓰지 않는 이유이기도 하다.
