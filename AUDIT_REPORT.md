# ZAPPI POS 종합 감사 보고서 (통합본)

> 42,000+ LOC / 전체 플로우 코드 레벨 분석 / 총 63건

---

## CRITICAL (14건) — 즉시 수정 필요

### 결제 플로우 (6건)

| # | 이슈 | 파일:라인 | 상세 |
|---|------|----------|------|
| **C-P1** | **EcashReceiveScreen (NUT-18) 잔액 갱신 안됨** | `MainApp.tsx:1098-1106` | `onPaymentReceived` prop 미전달. 성공 후 `onPaymentReceived?.(receivedAmount)` → undefined. **추가로** GiftWrapListener가 `triggerTxRefresh()`만 호출하고 `refreshBalance()` 미호출 → **NUT-18 수령 후 홈 화면 잔액이 업데이트되지 않음** |
| **C-P2** | **TokenReceiveScreen 신뢰하지 않는 민트 수령 무제한** | `TokenReceiveScreen.tsx:229-232` | 수령 버튼 `disabled={isReceiving}`만 체크. `isMintTrusted` 미검증. 반면 ReceiveScreen(:822)과 POSEcashStep(:153)은 `!isTrustedMint`로 차단. **3개 화면 중 이것만 신뢰 체크 빠짐** → 악의적 민트 토큰 수령 가능 |
| **C-P3** | **이캐시 토큰 생성 후 뒤로가기 → 자금 손실** | `EcashSendScreen.tsx:448`, `SendScreen.tsx:371-372,658` | 토큰 생성 후(proof 소비됨) 헤더 ← 버튼이 `onBack()` 직접 호출. 경고/reclaim 없이 화면 이탈. MainApp `handleCreateEcashToken`(:647-648)에서 pending을 제거하고 tx를 completed로 저장하므로 **복구 메커니즘도 작동 안함** |
| **C-P4** | **더블 탭 방지 불완전** | `LightningSendScreen.tsx:119-145` | ref 기반 잠금 없이 `disabled` 속성만 의존. 비동기 상태 업데이트 이전 빠른 더블탭으로 중복 결제 가능. (EcashSendScreen/SendScreen은 `isCreatingRef`로 보호됨) |
| **C-P5** | **WebSocket cleanup 메모리 누수** | `EcashSendScreen.tsx:250-284` | 구독 에러 콜백에서 `unsubscribe` 미호출. 에러 발생 시 WebSocket 커넥션 누수 |
| **C-P6** | **인보이스 만료 단위 불일치** | `LightningReceiveScreen.tsx:127,164` vs `ReceiveScreen.tsx:326-327` | LightningReceiveScreen은 `quoteExpiry`를 초 단위 저장 후 비교 시 `*1000`, ReceiveScreen은 저장 시 `*1000`하여 밀리초 저장. 동일 프로젝트에서 동일 데이터 다른 단위 처리 |

### 보안 (5건)

| # | 이슈 | 파일:라인 | 상세 |
|---|------|----------|------|
| **C-S1** | **비밀번호 비교 타이밍 공격** | `security.service.ts:277` | `===` 연산자로 해시 비교 → 타이밍 차이로 해시 추론 가능. constant-time 비교 필요 |
| **C-S2** | **패스키 PIN 암호화에 공개 credential ID 사용** | `passkey.ts:86-108` | credential ID는 localStorage에 평문 저장 → 암호화 키로 부적절. 마스터 비밀번호를 키 소재로 사용해야 함 |
| **C-S3** | **비밀번호 해시 localStorage 저장** | `security.service.ts:222` | XSS 시 해시 노출. IndexedDB + 앱 레벨 암호화 필요 |
| **C-S4** | **니모닉 메모리 평문 캐시** | `seedGetter.ts:7-31` | 전역 변수에 니모닉 평문 보관, visibility change 시 미삭제 |
| **C-S5** | **Math.random()으로 ID 생성** | `ReceiveScreen.tsx:423` | 암호학적으로 안전하지 않음. `crypto.getRandomValues()` 사용 필요 |

### 네비게이션 (3건)

| # | 이슈 | 파일:라인 | 상세 |
|---|------|----------|------|
| **C-N1** | **잠금 해제 후 이전 화면 복원 안됨** | `MainApp.tsx:860` | POS/키오스크 모드에서 잠금 → 해제 시 home으로 이동. `currentScreen`을 store에 보존 필요 |
| **C-N2** | **결제 진행 중 뒤로가기 무방비** | `LightningSendScreen.tsx:18` | `isLoading` 상태에서도 ← 버튼 활성화. 라이트닝 결제 진행 중 화면 이탈 가능 |
| **C-N3** | **ReceiveScreen 성공 자동 dismiss 경합** | `ReceiveScreen.tsx:501-509,528` | 4초 자동 dismiss + "확인" 버튼 모두 `onBack()` 호출. 거의 동시 실행 가능 |

---

## HIGH (16건) — 릴리스 전 수정 필요

### 결제 플로우 (4건)

| # | 이슈 | 파일:라인 | 상세 |
|---|------|----------|------|
| **H-P1** | **LightningReceiveScreen 성공 화면 없음** | `LightningReceiveScreen.tsx:149-156` | `handlePaid`에서 `onBack()` 바로 호출. 다른 모든 화면(ReceiveScreen 컨페티, TokenReceiveScreen 체크아이콘, LightningSendScreen 체크아이콘, TransferScreen 체크아이콘)에는 성공 화면 있음. **이 화면만 유일하게 없음** → 사용자가 결제 완료를 인지 못함 |
| **H-P2** | **POSScreen 이캐시 결제를 Lightning으로 잘못 기록** | `MainApp.tsx:968` | `onPaymentReceived={(amount) => handlePaymentReceived(amount, 'lightning')}` → POS에서 이캐시 결제 시에도 `'lightning'` 타입 전달. 토스트가 "라이트닝 결제 완료"로 표시 |
| **H-P3** | **GiftWrapListener 토큰 수령 후 잔액 미갱신** | `useGiftWrapListener.ts:206` | `triggerTxRefresh()`만 호출. MainApp의 txRefreshTrigger effect(:166-173)는 트랜잭션만 다시 로드하고 `refreshBalance()` 미호출. **DM으로 받은 모든 토큰에 대해 홈 화면 잔액이 즉시 반영 안됨** |
| **H-P4** | **GiftWrapListener 신뢰하지 않는 민트 무조건 수령** | `useGiftWrapListener.ts:161-165` | 경고 로그만 출력 후 무조건 `receiveP2PKToken` 호출. 사용자 동의 없이 알 수 없는 민트의 토큰을 자동 수령 |

### 보안 (4건)

| # | 이슈 | 파일 | 상세 |
|---|------|------|------|
| **H-S1** | **잠금 시도 우회** | `LockScreen.tsx:72` | lockout 상태가 localStorage 평문 → 삭제로 우회 가능 |
| **H-S2** | **패스키 attestation 미인증** | `passkey.ts:192` | `attestation: 'none'` → 인증기 무결성 미검증 |
| **H-S3** | **HTTPS 미강제** | 전체 | CSP/HSTS 헤더 없음. PWA에서 중간자 공격 가능 |
| **H-S4** | **프로덕션 console.log 보안 정보 출력** | `seedGetter`, `useGiftWrapListener(:112)` 등 | 키 정보, 토큰 데이터 콘솔 출력. GiftWrapListener는 **매 렌더마다** 키 정보 로그 |

### UI/UX (4건)

| # | 이슈 | 파일 | 상세 |
|---|------|------|------|
| **H-U1** | **터치 타겟 미달** | Modal 닫기 버튼 ~20px, PinInput 키패드 등 | 최소 44x44px 미달 다수. 모바일에서 터치 정확도 문제 |
| **H-U2** | **하드코딩 색상 100+회** | 전체 | `#e4e0d5`, `#264032` 직접 사용. CSS 변수 미사용 → 다크모드 불가, 테마 변경 불가 |
| **H-U3** | **접근성 치명적 결함** | 전체 | aria-label 누락, color-only 상태 표시, 명암비 부족. WCAG AA 미충족 다수 |
| **H-U4** | **타이포그래피 비일관** | 전체 | text-[6px]~text-3xl 혼재, font-bold 과다 사용. 일관된 스케일 부재 |

### 최적화 / 상태관리 (4건)

| # | 이슈 | 파일 | 상세 |
|---|------|------|------|
| **H-O1** | **히스토리 가상화 미적용** | `HistoryScreen.tsx:230` | 1000+ 트랜잭션 전체 DOM 렌더 → 메모리 스파이크 |
| **H-O2** | **타이머 cleanup 누락** | `LightningReceiveScreen.tsx:142-200` | 컴포넌트 언마운트 시 폴링 인터벌 계속 실행 가능 |
| **H-D1** | **Error Boundary 부재** | 전체 | 컴포넌트 크래시 → 앱 전체 화이트스크린. 복구 불가 |
| **H-D2** | **크로스탭 동기화 없음** | 전체 | 두 탭에서 동시 결제 시 잔액 불일치, 이중지불 위험 |

---

## MEDIUM (23건) — 다음 릴리스

### 결제 플로우 (8건)

| # | 이슈 | 파일 | 상세 |
|---|------|------|------|
| M-P1 | 키오스크 잠금모드 이캐시 결제 불가 | `KioskScreen.tsx:206-239` | 잠금모드 체크아웃은 Lightning만 지원. 관리자모드는 ReceiveScreen(Lightning+Ecash) 모두 지원 |
| M-P2 | KioskScreen 직접 claimPayment 호출 | `KioskScreen.tsx:145-150` | MainApp의 `handlePaymentReceived`를 거치지 않고 직접 `claimPayment` + `loadBalance`. 통합 흐름과 별도 경로 존재 |
| M-P3 | 민트 자동 전환 사용자 미통지 | 다수 | 오프라인 민트 → 다른 민트로 무통보 전환 |
| M-P4 | 폴링 간격 비일관 | ReceiveScreen 2초, 나머지 3초 | 통일 필요 |
| M-P5 | 네트워크 중단 시 복구 없음 | 다수 | 결제 중 네트워크 끊김 → 타임아웃까지 무한 대기 |
| M-P6 | TokenReceiveScreen 민트 건강 체크 없음 | `TokenReceiveScreen.tsx` | 오프라인 민트 토큰 수신 시도 → 실패 (ReceiveScreen에서는 체크함) |
| M-P7 | 인보이스 생성 재시도 무제한 | 키오스크 | 민트 오프라인 시 무한 재시도 가능 |
| M-P8 | 성공 화면 동작 불통일 | 전체 | 자동닫기(4초) vs 수동닫기 vs 성공화면 없음 — 아래 비교표 참조 |

#### 성공 화면 동작 비교표

| 화면 | 성공 화면 | 닫기 방식 | 잔액 갱신 | 신뢰 체크 |
|------|----------|---------|----------|---------|
| ReceiveScreen (Lightning) | 컨페티 | 4초 자동 | O | N/A |
| ReceiveScreen (Ecash) | 컨페티 | 4초 자동 | O | **차단** |
| LightningReceiveScreen | **없음** | N/A | O | N/A |
| TokenReceiveScreen | 체크아이콘 | 수동 | O | **미차단** |
| EcashReceiveScreen (NUT-18) | 체크아이콘 | 수동 | **X** | N/A |
| POSScreen (Lightning) | POSSuccessView | 자동 | O | N/A |
| POSScreen (Ecash) | POSSuccessView | 자동 | O | **차단** |
| SendScreen (Lightning) | 컨페티 | 수동 | O | N/A |
| SendScreen (Ecash) | QR 표시 | 수동 | O | N/A |
| LightningSendScreen | 체크아이콘 | 수동 | O | N/A |
| EcashSendScreen | QR/DM 상태 | 수동 | O | N/A |
| TransferScreen | 체크아이콘 | 수동 | O | N/A |
| KioskScreen (잠금) | 체크아이콘 | 4초 자동 | O | Lightning만 |

### 네비게이션 (3건)

| # | 이슈 | 파일 | 상세 |
|---|------|------|------|
| M-N1 | `validatedScanData` 정리 안됨 | `MainApp.tsx:106` | 스캔 후 화면 이탈 시 null 미초기화. AmountAction 경로에서만 초기화 |
| M-N2 | `previousScreen` 정리 불일관 | `MainApp.tsx` | 일부 화면은 null 초기화, 일부는 미초기화 |
| M-N3 | 키오스크 모드 종료 시 상태 미정리 | `MainApp.tsx` | `kioskPaymentAmount`, `kioskOrderMetadata` 잔존 가능 |

### 보안 (3건)

| # | 이슈 | 파일 | 상세 |
|---|------|------|------|
| M-S1 | LNURL 도메인 미검증 | `lnurl.ts:42-43` | URL 인젝션 가능 |
| M-S2 | 비표준 seed 도출 | `seedGetter.ts:39-46` | BIP-39 대신 커스텀 SHA256 도출 → 호환성 문제 |
| M-S3 | IndexedDB 미암호화 | 전체 | 프루프/트랜잭션 평문 저장 |

### UI/UX (4건)

| # | 이슈 | 파일 | 상세 |
|---|------|------|------|
| M-U1 | 빈 상태 표시 불완전 | 거래 내역, 알림, 민트 목록 | 빈 상태 미처리 |
| M-U2 | pull-to-refresh 없음 | 전체 | 모바일 표준 동작 미구현 |
| M-U3 | 반응형 대응 부분적 | 키패드, PinInput, 홈 액션 버튼 | 큰 화면 미대응 |
| M-U4 | backdrop-blur 성능 | 모든 모달 | 구형 기기 프레임 드랍 |

### 최적화 / 상태관리 (5건)

| # | 이슈 | 파일 | 상세 |
|---|------|------|------|
| M-O1 | KioskScreen 카테고리 매 렌더 재계산 | `KioskScreen.tsx:65` | `useMemo` 미적용 |
| M-O2 | `React.memo` 미사용 | TransactionList, KioskScreen, HistoryScreen 등 | 불필요 리렌더 |
| M-O3 | WebSocket timeout 누수 | `useGiftWrapListener.ts:521` | `Promise.race` 후 timeout 미정리 |
| M-O4 | 월렛 캐시 설정 변경 시 미무효화 | `wallet-cache.ts` | 민트 변경 시 stale 인스턴스 유지 |
| M-D1 | 설정 저장 중 크래시 시 불일치 | `MainApp.tsx:699-706` | Zustand 즉시 업데이트 → IndexedDB 저장 실패 시 데이터 불일치 |

---

## LOW (10건) — 개선 사항

| # | 이슈 | 상세 |
|---|------|------|
| L1 | 딥링크 미구현 | `zappi://send?...` 등 외부 링크 처리 불가 |
| L2 | 스캐너 중복 스캔 디바운스 없음 | 빠른 연속 스캔 시 다중 화면 전환 |
| L3 | `prefers-reduced-motion` 미지원 | 모션 민감 사용자 배려 없음 |
| L4 | 토스트 최대 스택 제한 없음 | 다수 동시 토스트 쌓임 |
| L5 | 히스토리 무한 스크롤 없음 | `maxItems=10` 이상 로드 불가 |
| L6 | sats 단위 위치 비일관 | 화면별 앞/뒤 혼재 |
| L7 | 전역 unhandled rejection 핸들러 부재 | 미처리 프로미스 에러 무시 |
| L8 | 하이드레이션 타임아웃 없음 | IndexedDB 느릴 시 무한 초기화 |
| L9 | `useGiftWrapListener` deps 불완전 | `:582` eslint-disable로 스테일 클로저 위험 |
| L10 | `cancelled` 플래그 미사용 | `MainApp.tsx:248` — async effect 재실행 시 이전 작업이 상태 덮어쓰기 |

---

## 요약 통계

| 심각도 | 건수 | 영역 |
|--------|-----|------|
| **CRITICAL** | 14 | 결제 6, 보안 5, 네비게이션 3 |
| **HIGH** | 16 | 결제 4, 보안 4, UI/UX 4, 최적화/상태 4 |
| **MEDIUM** | 23 | 결제 8, 네비게이션 3, 보안 3, UI/UX 4, 최적화/상태 5 |
| **LOW** | 10 | 기타 |
| **총계** | **63** | |

---

## 우선순위 로드맵

### Phase 1 — 즉시 (자금 보호 + 핵심 보안)

1. **C-P1** EcashReceiveScreen `onPaymentReceived` 전달 + GiftWrapListener `refreshBalance()` 추가
2. **C-P2** TokenReceiveScreen 신뢰하지 않는 민트 수령 차단 (ReceiveScreen/POSEcashStep과 통일)
3. **C-P3** 이캐시 토큰 생성 후 뒤로가기에 확인 다이얼로그 + 자동 reclaim
4. **C-S1** 비밀번호 constant-time 비교
5. **C-S2** 패스키 PIN 암호화 키 변경
6. **C-P4** 더블탭 방지 ref 잠금 전체 적용
7. **C-S5** `crypto.getRandomValues()` 적용
8. **H-D1** Error Boundary 추가

### Phase 2 — 릴리스 전 (안정성 + UX 통일)

9. **H-P1** LightningReceiveScreen 성공 화면 추가
10. **H-P2** POSScreen 이캐시 결제 타입 정정 (`'ecash'` 전달)
11. **H-P3** GiftWrapListener 잔액 갱신 추가
12. **C-P5** WebSocket cleanup 보장
13. **C-N1** 잠금 해제 후 화면 복원
14. **H-O2** 타이머/인터벌 cleanup 수정
15. **H-O1** 리스트 가상화
16. **H-U1** 터치 타겟 44px 최소 보장
17. **H-U2** 하드코딩 색상 → CSS 변수
18. **M-P8** 성공 화면 동작 통일 (자동닫기 vs 수동닫기 표준화)

### Phase 3 — 다음 릴리스 (품질 + 완성도)

19. **H-U3** 접근성 개선
20. **H-D2** 크로스탭 동기화
21. **M-P1** 키오스크 잠금모드 이캐시 결제 지원
22. **M-P3** 민트 전환 사용자 알림
23. **C-P6** quoteExpiry 단위 통일
24. **M-U1** 빈 상태 UI 완성
25. **M-O1,O2** useMemo/React.memo 적용
26. **H-S4** 프로덕션 console.log 제거

---

*Generated: 2026-02-13*
*Scope: zappi_pos/src/ 전체 (42,000+ LOC)*
