# ZAPPI POS 구현 진행 상황

## 구현 완료 기능

### 1. 기반 시스템 (Foundation) ✅
- [x] BIP-39 키 유도 로직 구현
- [x] 시드 암호화 저장 (Web Crypto API - AES-256-GCM)
- [x] 설정 화면 (Mint, Relay)
- [x] Dexie.js 데이터베이스 스키마 설계
- [x] kind:10019 발행 로직

### 2. 지갑 기능 (Wallet) ✅
- [x] 금액 입력 키패드 UI
- [x] QR 코드 생성/표시
- [x] Lightning Invoice 생성 및 결제 확인
- [x] Ecash 토큰 수신/전송
- [x] 거래 내역 리스트 뷰
- [x] 민트별 잔액 표시

### 3. 키오스크 모드 (Kiosk Mode) ✅
- [x] 상품 등록/수정/삭제 (CRUD)
- [x] 상품 이미지 업로드 (카메라/갤러리)
- [x] 카테고리 기능
- [x] 장바구니 기능
- [x] 주문 상세 저장
- [x] 관리자 잠금/해제 기능
- [x] 결제 화면 연동

### 4. UI/UX ✅
- [x] PWA 설치 안내 화면
- [x] 온보딩 (지갑 생성/복구)
- [x] 잠금 화면
- [x] 토스트 알림
- [x] 페이지 트랜지션 애니메이션
- [x] 모바일 최적화 레이아웃

### 5. 보안 ✅
- [x] AES-256-GCM 니모닉 암호화
- [x] PBKDF2 키 파생 (100,000 iterations)
- [x] Passkey (Face ID/Touch ID) - AES-GCM 암호화

---

## 아키텍처

### 디렉토리 구조
```
src/
├── core/           # 타입 정의, 상수
│   ├── types/
│   └── constants/
├── data/           # 데이터 레이어
│   ├── database/   # Dexie 스키마 (zappi_db)
│   ├── repositories/
│   └── cache/
├── store/          # Zustand 통합 스토어
│   ├── slices/
│   └── index.ts
├── services/       # 비즈니스 로직
│   ├── security/
│   ├── wallet/
│   ├── payment/
│   ├── sync/
│   └── profile/
├── hooks/          # React 훅
├── ui/             # UI 컴포넌트
│   ├── components/
│   └── screens/
├── coco/           # Cashu 지갑 브릿지
└── utils/          # 유틸리티 함수
```

### 데이터 흐름
```
UI Screen
    ↓
useAppStore (Zustand) ← 메모리 상태
    ↓
Service Layer / Repository
    ↓
IndexedDB (zappi_db) ← 영구 저장
    ↓
Coco (Cashu Wallet) ← proofs 관리
```

---

## 최근 변경사항 (2026-02)

### 데이터 레이어 통합 완료
1. **레거시 코드 제거**
   - `src/db/` 디렉토리 삭제
   - `src/stores/` 디렉토리 삭제 (debug.ts, settings.ts, wallet.ts)
   - `src/hooks/useHydration.ts` 삭제

2. **통합 스토어 마이그레이션**
   - 모든 훅/서비스가 `useAppStore` 사용
   - `sync.slice.ts`에 누락 필드 추가 (lastEventTimestamp, txRefreshTrigger)
   - `debug.slice.ts` 신규 생성

3. **마이그레이션된 파일**
   - `useGiftWrapListener.ts` → 신규 Repository 사용
   - `useStateReconstruction.ts` → 신규 Repository 사용
   - `anchor.ts` → useAppStore 사용
   - `bridge.ts` → useAppStore 사용
   - `SettingsScreen.tsx` → useWalletStore 제거
   - `nostr.ts` → 미사용 함수 제거

### Passkey 보안 강화
1. **XOR → AES-256-GCM 전환**
   - 기존: 단순 XOR (즉시 복호화 가능)
   - 변경: AES-256-GCM + PBKDF2 (100,000 iterations)

2. **저장 형식 변경**
   - 키: `passkey_encrypted_pin_v2`
   - 값: `{ ciphertext, salt, iv }`

### UI 개선
- 키오스크 빈 상태 메시지 중앙 정렬

---

## 보안 아키텍처

### 암호화 계층
```
니모닉 (12/24 단어)
    ↓ AES-256-GCM + PBKDF2 (100,000 iter)
암호화된 니모닉 (localStorage)
    ↓
PIN으로 복호화
    ↓
Nostr 키 파생 (NIP-06)
```

### Passkey 흐름
```
Face ID/Touch ID 인증
    ↓
WebAuthn credential 검증
    ↓
PBKDF2로 키 파생 (credential ID + salt)
    ↓
AES-GCM으로 PIN 복호화
    ↓
PIN으로 니모닉 복호화
```

### 보안 한계 (웹앱)
- localStorage는 XSS에 취약
- WebAuthn은 인증만 제공, 암호화 키 저장 불가
- 네이티브 앱(Secure Enclave) 대비 보안 약함

---

## 남은 작업

### 우선순위 높음
- [ ] NutZap 실시간 수신 테스트
- [ ] 정산 기능 (Melt to Lightning Address)

### 우선순위 중간
- [ ] NIP-60 지갑 백업/복구
- [ ] 자동 정산 옵션
- [ ] 민트 상태 모니터링

### 우선순위 낮음
- [ ] 다국어 지원
- [ ] 테마 설정
- [ ] 거래 내역 내보내기
- [ ] 코드 스플리팅 (번들 크기 1.1MB+)

---

## 기술 부채

1. **청크 크기**: 번들 크기 1.1MB+
   - 코드 스플리팅 필요 (lazy loading)

2. **구 데이터베이스**: `zappi_pos` (Old) vs `zappi_db` (New)
   - 사용자 재로그인 시 니모닉 복구로 토큰 복원 가능
   - 구 DB 데이터 마이그레이션 불필요
