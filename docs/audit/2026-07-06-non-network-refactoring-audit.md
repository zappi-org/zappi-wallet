# Zappi Wallet 리팩토링 감사 보고서 (네트워크 영역 제외)

일자: 2026-07-06 · 검증 게이트: tsc/eslint/vitest(122파일·956테스트) 전부 통과 상태에서 감사.
네트워크 개편(docs/design/network-traffic-redesign.md, 0~7단계)과 그 문서에 이월 기록된 항목은 범위에서 제외.
모든 주장은 file:line 근거를 재검증한 것.

---

## 1. 거대 파일/컴포넌트 — 크기 × 변경빈도 × 결합도로 판정

| 우선순위 | 발견 | 근거 | 왜 문제 | 권장 조치 | 크기 |
|---|---|---|---|---|---|
| **[높음]** | `src/MainApp.tsx` 갓 컴포넌트 | 1,750줄. useState 21개·useCallback 32개·useEffect 10개, 화면 25종 직접 렌더, **핸들러 prop 99개** 하향 전달. 2026-01 이후 **커밋 150회로 저장소 1위** (2위 로케일 104회, HomeScreen 58회) | 단순히 긴 게 아니라 앱 셸+수동 라우터(`currentScreen`/`previousScreen` 1단 스택 + History API popstate, :1095-1135)+전 플로우 핸들러 허브(인보이스:583, 스왑:715, 토큰생성:833, 로그아웃:952, 민트추가:1026…)가 한 파일. 변경빈도 1위 = 충돌·회귀의 진앙 | ① 내비게이션(스크린 enum·back스택·popstate)을 `useAppNavigation` 모듈로 추출 ② 플로우별 핸들러를 도메인 훅으로 분리(`useReceiveHandlers`, `useTokenHandlers`, `useSecurityHandlers`) ③ 화면 switch를 라우트 테이블로. 라우터 도입 없이도 가능 | **L** |
| **[중간]** | `src/composition/bootstrap.ts` 단일 함수 | `createBootstrap()`이 :256→끝(~840줄) 하나의 함수. 커밋 56회 | 조립 지점 1곳 유지는 설계 의도(kill-switch 분기 1곳)라 **파일 분리는 금지**하되, 단일 함수 내부에 인프라/모듈/서비스/브리지/cleanup 6단계가 평면 나열되어 diff 리뷰가 사실상 불가능 | 반환 객체는 유지하고 내부를 `wireInfrastructure()`, `wireCashu()`, `wireTransferLifecycle()`, `wireCleanup()` 등 같은 파일 내 순수 함수로 절단. 배선 회귀 스냅샷 테스트가 가드 | **M** |
| **[중간]** | `src/ui/screens/Send/SendInputStep.tsx` + `SendFlow.tsx` | 790줄+702줄, 각각 커밋 45회. SendFlow props 11개(:112-131) | Send는 후속 작업이 다시 손댈 파일 — 지금 구조 정리를 안 하면 그 작업이 790줄 파일 위에서 이뤄짐. 파일 상단 헬퍼(looksLikeLightningAddress 등 :34-76)는 이미 순수 함수라 추출 비용 낮음 | 입력 판별 헬퍼→`send-input-detection.ts`로, 연락처 조회 로직→훅으로 선분리 | **M** |
| **[중간]** | `src/core/services/payment.service.ts` 갓 파사드 | 829줄, 공개 메서드 20+개. `findModuleForAccount(:242-245)`는 **accountId를 무시하고 첫 enabled 모듈 반환**(TODO 자인) | 모듈이 cashu 1개라 지금은 동작하지만 시그니처가 거짓말. 신규 모듈 추가 시 조용한 오배선 | reclaim/redeem 계열을 별도 유스케이스로 분리하고 findModuleForAccount는 accountId 매칭 구현 또는 파라미터 제거로 정직화 | **M** |
| **[낮음]** | `SupportPage.tsx` 1,531줄 / `SettingsScreen.tsx` 886줄 | SupportPage는 내부에 HelpHomeView(:719)·FaqView(:822)·TicketListView(:900) 등 이미 컴포넌트 분해됨 — 파일만 큼. SettingsScreen은 MainApp에서 콜백 12개 수령(:49-62) | 결합도 낮고 기계적 분할만 남음 | 뷰별 파일 분리(순수 이동) | **S** |

로케일 파일 5종(1,500줄대)은 데이터 파일이므로 분리 불필요 — 문제없음.

## 2. 아키텍처 경계 (헥사고날) — 전반적으로 우수, 위반 4건

**전수 스캔 결과**: core→외부 import **0건**, ui→composition **0건**, ui→core/services **0건**, store→core만 참조, adapters/modules에서 `useAppStore.getState()` 직접 호출 **0건**(전부 bootstrap에서 getter 주입). 구조 건강함.

| 우선순위 | 발견 | 근거 | 왜 문제 | 권장 조치 | 크기 |
|---|---|---|---|---|---|
| **[중간]** | 빈 객체 캐스팅 스텁이 레지스트리에 등록 | `bootstrap.ts:856-857` `const withdraw = {} as ServiceRegistry["withdraw"]` | 타입은 구현이 있다고 주장하지만 호출 즉시 런타임 TypeError. 죽은 LNURL 슬라이스(§8)와 한 몸 | 죽은 슬라이스 삭제와 함께 레지스트리 타입에서 제거 | S |
| **[중간]** | 온보딩 배선이 composition 밖 | `App.tsx:85` `new NostrGatewayAdapter(...)` + profile 서비스 생성이 UI 컴포넌트 내부 | 미니 조립 루트가 2곳(App.tsx, bootstrap.ts)으로 갈라져 온보딩 경로만 kill-switch·cursor 주입 규칙을 안 탐 | `composition/onboarding.ts`로 추출, App.tsx는 호출만 | S |
| **[낮음]** | ui→adapters 직접 import 2건 | `ui/hooks/use-redeem-token.ts:7,11` (TokenCodecAdapter 직접 인스턴스화 + 도메인 오케스트레이션까지 훅에서 수행), `ui/screens/Settings/pages/DiagnosticsPage.tsx:7` | 코덱은 port가 있는데 UI가 구현체 소유 | 코덱을 서비스 레지스트리 경유로; Diagnostics는 read 함수만 registry에 노출 | S |
| **[낮음]** | 테스트가 modules/*/internal 4곳 참조 | `__tests__/unit/composition/transfer-sdk-bridge.test.ts:13` 외 3 | 내부 리팩토링 시 테스트가 같이 깨짐(공개 계약 검증 아님) | 공개 표면 경유로 점진 교체 | S |

## 3. 상태 관리

| 우선순위 | 발견 | 근거 | 왜 문제 | 권장 조치 | 크기 |
|---|---|---|---|---|---|
| **[중간]** | wallet.slice의 유령 상태 (쓰기 전용) | `wallet.slice.ts:16-17` `mints: MintInfo[]`·`activeMintUrl`. **`setMints()` 호출부 0곳** → 배열 영원히 `[]`. 그런데 `updateMintStatus`는 4곳에서 호출(`use-mint-health.ts:34,48,77`, `bootstrap.ts:676`) — **빈 배열 위 map이라 전부 no-op**. 읽는 곳도 없음 | 죽은 상태에 살아있는 쓰기 코드가 붙어 "동작하는 척"함 | wallet.slice에서 mints/updateMintStatus/setMints/selectOnlineMints/selectActiveMint/selectIsReady 삭제, 호출부 4곳 제거 | **S** |
| **[중간]** | `activeMintUrl` 이중화 | store `wallet.slice`의 activeMintUrl vs `MainApp.tsx:205` 로컬 useState(실사용) | 같은 개념 두 저장소 | store 쪽 제거 | S |
| **[중간]** | `resetAll`의 이중 결함 | `store/index.ts:45-52`: 6개 슬라이스가 전부 `reset` 키 정의 → 스프레드 병합에서 **마지막 것만 생존**, 이를 우회하려고 :54-113에 **초기값 60줄 수동 복제** | 슬라이스 필드 추가 시 복제본 갱신을 잊으면 로그아웃 후 상태 잔존(지금은 reload가 가려줌) | 각 슬라이스 reset을 고유 이름으로, resetAll은 호출만. 복제 블록 삭제 | **S** |
| **[중간]** | MainApp의 `transactions` 스냅샷 prop drilling | `MainApp.tsx:144` useState → `refreshAll(:235-244)` → **5개 화면에 prop 전달** | repo 파생 상태를 셸이 수동 소유·갱신. 갱신 누락 = 화면 간 불일치 | `useTransactions` 훅 또는 store 슬라이스로 이동 | **M** |
| **[낮음]** | pendingQuotes 액션 절반 미사용 | `addPendingQuote`만 실사용 | 수명 관리 없는 append-only 상태 | 소비자 확정 또는 축소 | S |

## 4. 에러 처리 일관성

| 우선순위 | 발견 | 근거 | 왜 문제 | 권장 조치 | 크기 |
|---|---|---|---|---|---|
| **[중간]** | Result 타입 2종 공존 | 클래스형 `core/types/result.ts`: 비테스트 **6파일만** 사용. 유니언형 `core/domain/result.ts`가 지배적(`.ok` 57곳 vs isOk 16곳) | 인지 부하 + 새 코드의 선택 규칙 부재. 6파일이면 마이그레이션 저렴 | 유니언형으로 통일, 클래스형 삭제 | **S-M** |
| **[중간]** | core 서비스의 원시 `throw new Error` 19곳 | 예: `input-router.service.ts:63`, `transfer-lifecycle.service.ts:215` | code 없는 Error는 i18n 매핑(translateError) 불가 → 영어 원문 표출 | BaseError 서브클래스로 교체 | S |
| **[중간]** | silent swallow 중 위험 지점 | `swap.service.ts:334-335` — 실패 스왑 tx의 failed 마킹 실패를 무음 삼킴 → **영원히 pending으로 보이는 거래 가능**. `MainApp.tsx:1339` raw error.message 토스트 | 진단 불능 + 오표시 | tx-status 계열 catch에 console.error 표준화 | S |
| **[낮음]** | `errors.serviceNotReady` 키 5개 로케일 전부 부재 | 코드는 존재(`core/errors/base.ts:45`) | 표출 시 raw 키 렌더 | 키 추가 | S |

## 5. 저장/스키마

| 우선순위 | 발견 | 근거 | 왜 문제 | 권장 조치 | 크기 |
|---|---|---|---|---|---|
| **[높음]** | **로그아웃 후 이전 계정 데이터 잔존 — bearer 토큰 포함** | 로그아웃(`MainApp.tsx:952-972`)은 수동 조합인데 **`failedIncomings`(payload = 수신 실패한 raw ecash 토큰), `pendingTransfers`, `receiveRequests`, `processedRecords`, `supportTickets/Messages`(문의 원문), `mintMetadata`, `exchangeRates`가 삭제 안 됨**. `clearAllData`는 **호출부 0곳 죽은 함수**이며 그마저 목록 누락 | 니모닉 교체 시 이전 계정의 미상환 bearer 토큰·문의·이력이 평문 잔존(프라이버시+자금 단서), pendingTransfers는 새 계정 UI에 부활 가능 — 같은 클래스 버그를 incomingReviews에서 이미 겪음 | 테이블 나열식 폐기 → 로그아웃 = `db.delete()`(DB 통째 드롭) + coco DB 삭제 + reload로 단일화 | **S-M** |
| **[중간]** | `proofs` 테이블은 죽은 스키마 | `db.proofs` 쓰기 코드 **0곳** — 실제 proof는 coco 자체 DB 소관 | "여기에 돈이 있다"는 오해 유발, clearMintData가 헛삭제 | 다음 스키마 버전에서 `proofs: null` 툼스톤 | S |
| **[낮음]** | 마이그레이션 부채 | 단일 version + 툼스톤 2 + @deprecated 필드 2 — 관리되고 있음 | 당장 조치 불필요 | proofs 정리 때 동승 | S |
| **[낮음]** | localStorage 키 산재 (7종+) | lockout, zappi_invite_*, zappi-language, passkey_* 등 | 중앙 레지스트리 없음 — wipe 목록 누락 위험 | `STORAGE_KEYS`로 수렴 | S |

`syncAnchor`/`processedRecords`는 살아있는 테이블 — 정리는 네트워크 개편 이월 소관.

## 6. 보안·키 취급

암호화 설계 자체는 우수(하단 "문제없음" 표). 결함:

| 우선순위 | 발견 | 근거 | 왜 문제 | 권장 조치 | 크기 |
|---|---|---|---|---|---|
| **[높음]** | **자동잠금이 장식품 — 비밀키가 세션 내내 무방비** | `setLocked(true)` 호출부 **전무**. `SecurityService.lock()`·`clearCachedMnemonic()` 호출부 0. 설정의 autoLock UI는 렌더되지만 **소비하는 타이머/visibility 훅이 없음** | "5분 자동잠금"을 약속하고 실제로는 unlock 이후 니모닉(평문 string)·시드·nostr 키가 영구 상주. 허위 보안 약속 | idle 타이머+visibilitychange 기반 lock 구현. 핫월렛 특성상 잠금 범위 정책(시드캐시만 vs gateway 포함) 결정 필요 | **M** |
| **[중간]** | nostr 개인키가 devtools 무게이트 store에 | `settings.slice.ts:15,54` + `store/index.ts:33` devtools에 `enabled: import.meta.env.DEV` 없음 | DevTools 확장 설치된 프로덕션 브라우저에서 개인키 스트리밍 | enabled 게이트 1줄 + 장기적으로 privkey를 registry 클로저로 | **S** |
| **[중간]** | PBKDF2 100k × 6자리 PIN | `encryption.adapter.ts:9` | OWASP 권고(≥600k) 미달 + PIN 엔트로피 ~20bit. 디바이스 키 이중 래핑이 완화 | 반복수 상향(재암호화 마이그레이션) 또는 Argon2id | M |
| **[중간]** | POS 하위 개인키 QR/클립보드 반출 | `POSSettingPage.tsx:79-101,135` | 지출 가능 키가 클립보드 경유 | 클립보드 타이머 클리어 + 경고 | S |
| **[낮음]** | 니모닉 클립보드 자동삭제 없음 / 복구입력 autoComplete 미지정 | `OnboardingScreen.tsx:317` 등 | 클립보드 매니저 유출 | n초 후 덮어쓰기, autoComplete="off" | S |
| **[낮음]** | 프로덕션 console 148곳 | `TokenScreen.tsx:197,214` 토큰 상세 로깅 | 금액·민트·메모 콘솔 상주 | esbuild drop console | S |

## 7. i18n

| 우선순위 | 발견 | 근거 | 권장 조치 | 크기 |
|---|---|---|---|---|
| **[높음]** | 한국어 하드코딩 4지점 | `TokenRawSheet.tsx:206,214,222,231`, `use-global-token-claim-toast.ts:45-46`, `MainApp.tsx:1336,1339-1340`(+raw error 토스트) | 키 추가 후 t() 치환 | **S** |
| **[높음]** | 로케일 키 드리프트 — support가 ja/id/es에서 통째로 영어 | en 1277 / ja 1205 / id·es 1194 — **ja 77·id 88·es 88개 부재** + 영어 복붙 다수. ko도 settings.tls* 6키 부재. 고아 키 5개 | support.* 번역 + 고아 삭제 | **M** |
| **[중간]** | **근본 원인: 컴파일 타임 키 검증 부재** | `i18n/index.ts:21-27` — CustomTypeOptions 증강 없음 → t() 키가 그냥 string | `typeof en` 스키마 선언 — 이후 드리프트는 tsc가 차단 | **S** |
| **[중간]** | PWAInstallGuard 영어 하드코딩 | `PWAInstallGuard.tsx:88-105` | t() 적용 | S |

## 8. 죽은 코드/중복

| 우선순위 | 발견 | 근거 | 권장 조치 | 크기 |
|---|---|---|---|---|
| **[높음]** | **URL 정규화기 9종 분기 — 동작 불일치 = 잠재 버그** | 정본 `utils/url.ts` 외에 `remove-mint.ts:10`·`cashu-recovery.ts:379`·`wallet-cache.ts:7`(슬래시 1개만)·`routing.ts:183`·`nostr-direct-payment.service.ts:67`(**소문자화** — 정본은 안 함)·`bootstrap.ts:868`(전체 슬래시 제거)·`external-mnemonic-mint-discovery.adapter.ts:188`·`customer-support-config.ts:123`(슬래시 **추가**)·nostr-tools normalizeURL 병용 | `utils/url.ts`로 수렴, 소문자화 여부 1회 결정, 동등성 회귀 테스트 | **M** |
| **[중간]** | 죽은 LNURL-auth/withdraw 수직 슬라이스 (6파일+포트 2) | 호출부 0 — `bootstrap.ts:856-857`이 `{}` 캐스팅으로 대체. `@noble/curves` 의존성도 이것 때문에 잔존 | 일괄 삭제, 레지스트리 타입에서 제거 | **S** |
| **[중간]** | shadcn primitives 40파일 전체 고아 | `src/ui/primitives/*` 43파일 중 실사용은 cn 유틸뿐. radix 26패키지가 죽은 무게 | cn 이동 후 폴더+radix·embla·cmdk·vaul·input-otp 제거 | **S-M** |
| **[낮음]** | 고아 파일·중복 유틸 묶음 | 훅 4, 컴포넌트 섬 9, `FaceIdSettingPage`, `PinChangeModal`, `wallet-cache.ts`, mock-store가 프로덕션 디렉토리에, `MainApp.tsx:590-595` 주석 코드. hex/bytes 변환 4-5벌, truncateStr 2벌, 상대시간 2벌 | 일괄 삭제 PR + mock-store는 `__tests__`로. `TokenCreate/mockData.ts`는 실동작 코드이므로 **삭제 금지, 개명** | **S** |

## 9. 테스트 품질 (956개 전원 통과 — 공백이 위험 지점에 집중)

| 우선순위 | 발견 | 근거 | 권장 조치 | 크기 |
|---|---|---|---|---|
| **[높음]** | 금액 변환·와이어 파싱 무검증 | `utils/format.ts:52-54` fiatToSats — 테스트 0. `token-codec.adapter.ts` — 테스트 파일 없음(:37 msat→sat floor, :147 fiat→sat round). `direct-lnurl.adapter.ts:117` sat→msat 무테스트 | 경계값(0, 1sat, 소수, NaN, 방향) 테이블 테스트 | **S** |
| **[높음]** | `transitionPhase` 무가드 + 도메인 테스트 부재 | `pending-transfer.ts:58-64` — 아무 phase→아무 phase 허용(settled→submitted 가능). 테스트 파일 없음 | 합법 전이 맵 도메인 정의 + 불법 전이 거부 + 테이블 테스트 | **M** |
| **[중간]** | 돈 이벤트 브리지 무테스트 | `coco-event-bridge.ts`, `gift-wrap-settlement.bridge.ts`, `mint-quote-observer.ts` — 테스트 0. composition 34파일 중 10개만 테스트 | transfer-tx-bridge.test 패턴으로 커버 | **M** |
| **[중간]** | 커버리지 강제 장치 부재 | thresholds 없음, all:true 없음 → 미임포트 파일은 통계 밖 | core/domain·composition에 디렉토리 스코프 임계 | S |
| **[낮음]** | swap drain 3회 반복·subtract 미커버 | `swap.service.ts:205-230` 분기 미주행 | 케이스 추가 | S |

## 10. 의존성

| 우선순위 | 발견 | 권장 조치 | 크기 |
|---|---|---|---|
| **[중간]** | 완전 미사용: `@nostr-dev-kit/ndk`, `sonner`, `react-resizable-panels`, `@noble/ciphers`, `@noble/curves`(죽은 파일만) | 제거 | **S** |
| **[낮음]** | `@testing-library/dom`이 dependencies에 / `postinstall: patch-package`인데 patches/ 없음 | devDeps 이동, postinstall 제거 | S |
| **[낮음]** | @noble/secp256k1 vs curves 병존 | 죽은 슬라이스 삭제 시 curves 소멸 → 단일화 | S |
| — | react 19 / vite 7 / vitest 4 / dexie 4 — 현행. 구버전 위험 없음 | — | — |

---

## 문제없음 확인 (근거 포함)

| 영역 | 확인 내용 | 근거 |
|---|---|---|
| 경계: core 순수성 | core→adapters/ui/store/composition/modules import 0건 | 전수 grep |
| 경계: ui→서비스 | service-context 훅 경유(직접 import 0) | grep 0건 |
| 경계: adapters의 store 접근 | getState() 직접 호출 0 — bootstrap getter 주입 | `bootstrap.ts:269-270` 패턴 |
| 니모닉 at-rest | AES-256-GCM + 랜덤 salt/IV + 비추출 디바이스 키 이중 래핑 | `encryption.adapter.ts:12-30`, `secure-storage.adapter.ts:65-69` |
| PIN 저장 | 평문 없음 — PBKDF2 해시+salt, 상수시간 비교 | `security.service.ts:50-59,202-209` |
| store 영속화 | persist 미들웨어 없음 | `store/index.ts:32-42` |
| 텔레메트리 | 외부 SDK 0, 카운터 PII-free·원격 전송 없음 | `net-counters.ts:4` |
| 생체 PIN | WebAuthn PRF 유래 키 AES-GCM, PRF 출력 미저장 | `passkey.ts:8,160-179` |
| 지원 키 위생 | Uint8Array + wipePrivateData()/fill(0) 제로화 | `derived-customer-support-key-provider.ts:23-64` |
| 외부 니모닉 복구 | 시드 파생만, 캐시/영속 없음 | `external-mnemonic-recovery.ts:76-82` |
| 에러→UI | translateError code 기반(직노출 예외 MainApp:1339 1곳) | `error-i18n.ts:116-119` |
| legacy-transaction-repo | 이름과 달리 살아있음(동적 import) — 삭제 금지 | `mint-quote-observer.ts:80` |
| 스토어 크기 | 슬라이스 8개 총 894줄 — 과대 아님 | wc 실측 |

---

## 우선순위 상위 5 — 무엇을, 왜, 어떤 순서로

1. **로그아웃 데이터 잔존 → `db.delete()` 단일화** (§5, S-M) — 이전 계정의 raw ecash 토큰·문의 원문이 실증 잔존. 같은 클래스 버그(incomingReviews)를 이미 blocker로 겪음.
2. **자동잠금 실구현 + devtools 게이트** (§6, M+S) — 표시되는 보안 기능이 허위. devtools 게이트는 1줄 즉시, idle-lock은 잠금 범위 정책 결정 후.
3. **URL 정규화기 수렴** (§8, M) — 민트 동등성 어긋남은 자금-표시 버그 클래스. 이후 모든 리팩토링의 지뢰 제거.
4. **죽은 코드 대청소** (§8·10, S-M) — LNURL 슬라이스+primitives+미사용 의존성+고아 파일. 5번의 선행 조건.
5. **MainApp 분해** (§1·3, L) — 내비게이션 추출 → 핸들러 훅 분리 → transactions 상태 이관. 1~4 후 최종 형태 확정.

병행: i18n 하드코딩 4지점+CustomTypeOptions(§7)는 독립 반나절 작업. 테스트 공백(fiatToSats/token-codec/transitionPhase)은 1·3번 작업의 안전망으로 해당 단계에 포함.
