# ZAPPI POS 기술 명세서

## 1. 프로젝트 개요

### 목표
상점 주인이 Nostr(NIP-61 NutZap) 및 Cashu 토큰을 직접 수취하고, 이를 논커스터디얼 방식으로 즉시 혹은 주기적으로 Lightning Network(비트코인)로 정산(Melt)받는 PWA 기반 POS 앱.

### 핵심 가치
- **Non-Custodial**: 모든 키와 자금의 통제권은 사용자(상점 주인)에게 있음
- **Seamless Settlement**: Cashu의 익명성과 Lightning의 범용성을 결합한 정산 프로세스
- **PWA**: 별도의 앱 스토어 설치 없이 모바일 POS 환경 제공

---

## 2. 프로토콜 요구사항

### Nostr 관련 (NIPs)

| NIP | 용도 | 설명 |
|-----|------|------|
| NIP-61 | NutZaps | 핵심 수취 수단. Nostr 이벤트를 통한 Ecash 전달 감지 및 복호화 |
| NIP-60 | Cashu Wallet | 지갑 상태(Proofs)를 릴레이에 암호화하여 백업/복구 |
| NIP-06 | Key Derivation | 단일 니모닉(BIP-39)에서 Nostr 키 유도 |
| NIP-40 | Expiration | 결제 요청 QR 및 이벤트의 유효 기간 관리 |

### Cashu 관련 (NUTs)

| NUT | 용도 | 설명 |
|-----|------|------|
| NUT-00/01/02 | 기본 | Mint 접속, Keyset 로딩 |
| NUT-03 | Swap | **[필수]** 수신된 토큰의 즉시 재발행을 통한 소유권 확정 및 이중 지불 방지 |
| NUT-04 | Mint | Bolt11 인보이스를 통한 신규 토큰 발행 |
| NUT-05 | Melt | **[핵심]** 보유 토큰을 소각하고 사용자의 Lightning Address로 비트코인 송금 |
| NUT-06 | Mint Info | 정산 수수료 확인 |

---

## 3. 키 관리 (Key Management)

### 결정 사항

| 항목 | 결정 | 비고 |
|------|------|------|
| 시드 | 단일 BIP-39 시드 | 12/24 단어 니모닉 |
| Nostr 키 | NIP-06 경로 사용 | `m/44'/1237'/0'/0/0` |
| Cashu P2PK | Nostr 키 사용 | `02` + Nostr pubkey |
| NUT-13 | 사용 안 함 | 추후 필요시 추가 |
| 백업 | NIP-60 | 릴레이에 암호화 백업 |

### 키 유도 구조
```
BIP-39 니모닉 (12/24 단어)
         │
         ▼
    마스터 시드
         │
         ▼
    m/44'/1237'/0'/0/0
         │
         ▼
    Nostr 키페어
    ├── 개인키 (nsec)
    └── 공개키 (npub) → P2PK 잠금에도 사용
```

---

## 4. 기능 요구사항

### A. 온보딩 및 설정 (Setup)

**키 관리:**
- BIP-39 니모닉 기반 마스터 시드 생성/복구
- 시드 암호화 저장 (Web Crypto API)

**환경 설정:**
- 연동할 Mint URL 선택 (다중 민트 지원)
- Nostr Relay 선택 (최소 3개)
- 정산받을 외부 Lightning Address 등록 (예: user@getalby.com)

**프로필 발행:**
- kind:10019 이벤트 발행 (NIP-61 수취 가능 상태 공표)
```json
{
  "kind": 10019,
  "tags": [
    ["relay", "wss://relay.damus.io"],
    ["relay", "wss://nos.lol"],
    ["mint", "https://mint.minibits.cash/Bitcoin", "sat"],
    ["pubkey", "02{nostr_pubkey}"]
  ]
}
```

### B. 단순 POS 모드 (Basic POS)

**흐름:**
```
1. 금액 입력
2. Mint에 createMintQuote(amount) 요청
3. Lightning invoice를 QR코드로 표시
4. 결제 감지 (polling)
5. mintTokens(quoteId)로 토큰 발행
6. 로컬 저장소에 저장
```

**상태 관리:**
- Pending: 결제 대기
- Successful: 결제 완료
- Expired: 만료됨

**특이사항:**
- P2PK 잠금 불필요 (직접 발행이므로)

### C. Nostr 결제 감지 모드 (NutZap Mode)

**실시간 감지:**
- NDK를 통한 릴레이 상시 리스닝
- kind:9321 (nutzap) 이벤트만 감지
- DM(kind:4) 감지 불필요

**자동 스왑 (Auto-Swap):**
- NutZap 수신 즉시 NUT-03 swap 실행
- 실패 시 즉시 재시도 (3-5회)
- 계속 실패 시 큐에 저장 → 민트 복구 시 재시도

**오프라인 복구:**
- 마지막 처리 시점(timestamp) 저장
- 온라인 복구 시 `since` 필터로 놓친 이벤트 조회
```javascript
relay.subscribe({
  kinds: [9321],
  "#p": [myPubkey],
  since: lastEventTimestamp
})
```

**백업:**
- NIP-60에 따라 갱신된 Proofs를 릴레이에 동기화

### D. 정산 및 환전 (Melt Management)

**정산 실행:**
```
1. Lightning Address에서 LNURL-Pay endpoint 조회
2. 원하는 금액으로 invoice 요청
3. invoice + proofs로 민트에 melt 요청
4. 민트가 invoice 결제
5. 완료
```

**정산 옵션:**
| 버튼 | 동작 |
|------|------|
| 전체 출금 | 모든 민트 순환 → 각 민트의 토큰 전부 melt |
| 민트별 출금 | 민트 선택 (다중 가능) → 선택한 민트들만 melt |

**자동화 옵션:**
- 앱 실행 중 특정 금액 이상 도달 시 자동 정산 (선택적)

**거래 내역:**
- 모든 수취 및 정산 내역의 히스토리 관리

---

## 5. 잔액 표시

```
┌─────────────────────┐
│ 총 잔액: 15,000 sat │
├─────────────────────┤
│ minibits: 10,000    │
│ coinos:    5,000    │
└─────────────────────┘
```

- 총 잔액 + 민트별 잔액 모두 표시

---

## 6. 에러 처리

### 민트 다운
- 해당 민트 관련 기능 비활성화
- "민트 연결 불가" 표시
- 백그라운드에서 주기적 재연결 시도

### 릴레이 다운
- 다른 릴레이로 자동 전환 (최소 3개 설정 이유)
- 모든 릴레이 다운 시 "오프라인" 상태 표시

### Swap 실패
```
1. 즉시 재시도 (3-5회)
2. 계속 실패 → 토큰 로컬 저장 + "swap 대기" 표시
3. 민트 복구 시 → 자동 재시도
4. 성공할 때까지 반복
```

**중요:** nutzap으로 받은 토큰은 이미 Nostr에 공개됨 → 빨리 swap 안 하면 누가 먼저 쓸 수 있음

---

## 7. 오프라인 모드

**인터넷 끊기면:**

| 기능 | 가능 여부 |
|------|-----------|
| 잔액 보기 | ✅ 로컬 데이터 |
| 거래 내역 보기 | ✅ 로컬 데이터 |
| nutzap 수신 | ❌ 릴레이 연결 필요 |
| Lightning 결제 받기 | ❌ 민트 연결 필요 |
| swap | ❌ 민트 연결 필요 |
| melt (출금) | ❌ 민트 연결 필요 |

**대응:**
- "오프라인" 배너 표시
- 로컬 데이터 조회만 허용
- 연결 복구 시 놓친 nutzap 자동 처리

---

## 8. 기술 스택

| 구분 | 기술 | 비고 |
|------|------|------|
| Framework | React + Vite + TypeScript | 빠르고 안정적인 개발 환경 |
| Cashu | cashu-ts | Cashu 프로토콜 라이브러리 |
| Nostr | NDK (@nostr-dev-kit/ndk) | NIP-61, 60 핸들링 및 릴레이 관리 |
| UI/UX | Tailwind CSS + shadcn/ui | 모바일 친화적 POS 디자인 |
| Storage | Dexie.js (IndexedDB) | Proofs 및 트랜잭션 로그 저장 |
| State | Zustand | 가벼운 전역 상태 관리 |
| PWA | vite-plugin-pwa | 오프라인 지원 및 설치형 웹 |

---

## 9. 개발 로드맵

### 1단계: 기반 시스템 구축 (Foundation)
- [ ] BIP-39 키 유도 로직 구현
- [ ] 시드 암호화 저장 (Web Crypto API)
- [ ] 설정 화면 (Mint, Relay, LN Address)
- [ ] Dexie.js 데이터베이스 스키마 설계
- [ ] kind:10019 발행 로직

### 2단계: 현장 결제 기능 (Basic POS)
- [ ] 금액 입력 키패드 UI
- [ ] QR 코드 생성/표시
- [ ] Mint Polling 및 토큰 수취 로직
- [ ] 거래 내역 리스트 뷰

### 3단계: Nostr NutZap 연동 (NutPOS Core)
- [ ] NDK 리스너 구현
- [ ] NIP-61 NutZap 파싱
- [ ] 수신 토큰 즉시 스왑 (NUT-03) 자동화
- [ ] NIP-60 기반 지갑 상태 백업
- [ ] 오프라인 복구 시 since 필터 처리

### 4단계: 정산 및 PWA 최적화 (Melt & PWA)
- [ ] LNURL-Pay를 통한 Melt 기능
- [ ] 전체 출금 / 민트별 출금
- [ ] PWA Manifest 및 Service Worker 설정
- [ ] 최종 UI 폴리싱

---

## 10. 관련 프로젝트

- **zappi_api**: NutZap 결제 API 서버
  - POS가 zappi_api를 통해 결제를 받을 수도 있음
  - zappi_api가 nutzap을 POS로 전송
