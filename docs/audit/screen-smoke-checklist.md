# 화면 스모크 체크리스트 (MainApp 분해 Phase 4 — 수동 QA용)

기준 코드: `src/MainApp.tsx` 라우트 테이블(`screenRoutes`) + `src/ui/hooks/use-app-navigation.ts`의 `Screen` 유니온.
`Screen` 유니온은 **21종**이다. 계획 문면의 "25종"에 맞춰, 유니온 밖 전역 UI 상태 **4종**(초기화 스플래시 / 잠금 / 홈 카메라 스캐너 / npub 민트 선택 시트)을 보충 표로 포함해 총 25항목으로 구성했다.
진입/이탈 경로는 전부 MainApp의 실제 배선(`setCurrentScreen` 호출부, 각 화면 prop)에서 읽어 작성했다.

## 공통 확인 (모든 화면 전환마다)

- [ ] 화면 전환 시 fade 애니메이션(PageTransition) 정상 — 흰 화면/이중 렌더 없음
- [ ] lazy 화면(Settings/Contacts/History/Transfer/Notifications/Analytics/AddMint/AmountAction/UsernameChange/TransactionDetail/MintDetail/MintManagement/RelayManagement) 첫 진입 시 Suspense 폴백 후 정상 마운트
- [ ] Android/브라우저 뒤로가기(popstate): 비-홈 화면에서 이전 화면 복귀, 홈에서는 앱 잔류. Settings 서브페이지 열림 시 서브페이지가 먼저 닫힘(capture 리스너 선점)
- [ ] 하단 내비 표시 규칙: 탭 화면(home/token/contacts/settings)에서만 표시, token 탭은 TokenTabToolbar(생성/등록)로 교체, Settings 서브페이지 열림 시 숨김

## Screen 유니온 21종

| # | Screen | 진입 경로 | 핵심 확인 항목 | 이탈 경로 |
|---|--------|-----------|----------------|-----------|
| 1 | `home` | 앱 시작 기본 화면(useAppNavigation 초깃값) / 하단 탭 '지갑' / 각 화면 back 폴백(previousScreen 없음) / Send·Receive `onComplete` / 민트 삭제 후 | ① 총 잔액 + 민트 카루셀 렌더 ② 최근 거래 리스트(실패 tx 숨김) ③ 당겨서 새로고침 → 잔액/거래/민트헬스/환율 갱신 | 탭 전환(token/contacts/settings) · `onTransactions`→history · `onNotifications`→notifications · `onAddMint`→add-mint · `onMintDetails`→mint-detail · `onSend`→send · `onReceive`→receive · `onScan`→카메라 모달 · `onSelectTransaction`→transaction-detail |
| 2 | `token` | 하단 탭 '토큰' / token-detail `onClose` / token-create·token-register의 back 폴백·`onComplete` | ① 토큰 타임라인(생성/등록/회수 이력) 렌더 ② 하단이 TokenTabToolbar(생성/등록 버튼)로 교체 ③ 스크롤 연동 툴바 동작(scrollRef 공유) | 토큰 선택→token-detail(슬라이드 오버레이) · 툴바 생성→token-create · 툴바 등록→token-register · 탭 전환 |
| 3 | `contacts` | 하단 탭 '연락처' | ① 연락처 목록 + 추가/수정 모달 ② 연락처 송금: npub 해석 → 공통 민트 결정 후 send 진입 | `onSendToContact`→send(validatedData·표시명·민트 주입) · 탭 전환 |
| 4 | `settings` | 하단 탭 '설정' | ① 설정 카테고리 목록 렌더 ② 지원(CS) 미읽음 배지가 탭 아이콘에 표시 ③ 서브페이지(PIN 변경·백업·CS 등) 열림 시 하단 내비 숨김(onSubPageChange) | `onBack`→home(탭 wallet) · mint-management · relay-management · username-change · transfer · analytics · 탭 전환 ※ PIN 변경/백업/로그아웃/CS는 내부 서브페이지(Screen 전환 아님) |
| 5 | `history` | Home `onTransactions`(민트 필터 옵션) / MintDetail `onTransactions`(해당 민트 필터, previousScreen='mint-detail') | ① 날짜 그룹 타임라인 렌더 ② `initialMintUrls` 민트 필터 적용 ③ 내보내기(export) 동작 | `onBack`→handleBack(home 또는 mint-detail) |
| 6 | `notifications` | Home `onNotifications` (previousScreen 미설정 — back은 home 폴백) | ① 거래 기반 알림 목록 렌더 ② 빈 상태 표시 | `onBack`→handleBack→home |
| 7 | `transfer` | Settings `onTransfer` (previousScreen='settings') | ① 민트 간 이동 폼 — `initialFromMintUrl`=활성 민트 반영 ② 이동 완료 시 잔액/거래 갱신(`onTransactionComplete`=refreshAll) | `onBack`→handleBack→settings |
| 8 | `analytics` | Settings `onAnalytics` (previousScreen='settings') | ① 거래 기반 차트 렌더(recharts lazy 청크 — 폴백 후 표시) ② 기간/필터 변경 반영 | `onBack`→handleBack→settings |
| 9 | `add-mint` | Home `onAddMint`(back 폴백 home) / MintManagement `onAddMint`(previousScreen='mint-management') | ① 민트 URL 검증 + 중복 검사 ② 추가 성공 시 설정 저장 후 자동 복귀(`onSuccess`) | `onBack`/`onSuccess`→previousScreen ‖ home |
| 10 | `mint-management` | Settings `onMintManagement` (previousScreen='settings') | ① 민트 목록 + 드래그 핸들 정렬(키보드 화살표 포함) ② 민트 데이터 클리어(`onClearMintData` — registry 준비 시에만 노출) | `onBack`→settings · `onAddMint`→add-mint |
| 11 | `relay-management` | Settings `onRelayManagement` (previousScreen='settings') | ① 릴레이 추가/삭제/정렬 ② 저장 실패 시 롤백 + 에러 토스트 | `onBack`→settings |
| 12 | `amount-action` | 유니버설 라우터: 카메라 스캔/입력값이 `amount` 타입일 때(routeValidatedInput) | ① 스캔된 금액 표시 ② mode 미지정 → 보내기/받기 선택 버튼 노출 | `onSend`→send(금액 주입) · `onReceive`→receive(금액 주입) · `onBack`→handleBack |
| 13 | `send` | Home `onSend`(민트 컨텍스트) / Contacts `onSendToContact` / AmountAction `onSend` / 카메라 스캔 sendable(bolt11·LN주소·LNURL-pay·cashu-request·my-wallet) / npub 해석 'ready' 또는 민트 시트 선택 후 / MintDetail `onCreateToken`(소스 민트 고정) / 레지스트리 미준비 스캔 폴백(주소 문자열만 주입) | ① validatedScanData 주입 시 목적지 스텝 스킵 ② 라우트 실행 성공 → 잔액/거래 갱신 + 완료 화면 ③ 수신형 입력 감지 시 receive로 리다이렉트 + 안내 토스트 | `onBack`→previousScreen ‖ home(연락처 정보 클리어) · `onComplete`→home · `onRedirect`→receive |
| 14 | `receive` | Home `onReceive` / AmountAction `onReceive` / SendFlow 리다이렉트(handleSendRedirect) | ① 인보이스/BIP-321 QR 생성(`onCreateInvoice`) ② 결제 수신 감지 → 완료 스텝(`onPaymentReceived`) ③ 수신 요청 이행 시 요청 상태 정리(`onReceiveRequestFulfilled`) | `onBack`→previousScreen ‖ home · `onComplete`→home |
| 15 | `username-change` | Settings `onChangeUsername` (previousScreen='settings') | ① 사용자명 입력 + 길이 제한 ② 저장 시 설정 반영 + 프로필 재발행(onSaveSettings 경유) | `onBack`→handleBack→settings |
| 16 | `transaction-detail` | Home `onSelectTransaction`(previousScreen='home') / MintDetail `onSelectTransaction`(previousScreen='mint-detail') **[state 가드: selectedTransaction — 없으면 렌더 안 함]** | ① 거래 상세 필드(금액/수수료/민트 라우트/시각) 렌더 ② back 시 선택 상태 클리어 후 이전 화면 복귀 | `onBack`→selectedTransaction 해제 + handleBack(home 또는 mint-detail) |
| 17 | `mint-detail` | Home `onMintDetails`(카드 탭, previousScreen='home') **[state 가드: selectedMint — 없으면 렌더 안 함]** | ① 민트 정보/잔액/보류 항목 렌더 ② 이름·색·카드 디자인 변경 즉시 반영(카드에도) ③ 민트 삭제: 최소 개수 가드 경고, 성공 시 데이터 클리어 + home 이동 + 토스트 | `onBack`→handleBack→home · `onCreateToken`→send · `onSelectTransaction`→transaction-detail · `onTransactions`→history · `onDeleteMint`→home |
| 18 | `token-create` | TokenTabToolbar `onCreate` (previousScreen='token') | ① 기본 민트 선택 규칙(잔액 있는 활성 민트→잔액 있는 첫 민트→첫 민트) ② 수수료 견적(`onEstimateFee`) 후 생성 → 토큰/QR 표시 ③ 생성 취소=회수(`onCancelToken`) 성공/실패 토스트 | `onBack`→previousScreen ‖ token · `onComplete`→token |
| 19 | `token-register` | TokenTabToolbar `onRegister` / 유니버설 라우터(cashu 토큰 스캔·붙여넣기 — initialRegisterToken 주입) / 미신뢰 수신 리뷰 effect(pendingIncomingReviews 발생 시 자동 진입) | ① 토큰 디코드 → 등록(상환) 흐름 ② 자기 토큰 감지(`onCheckSelfToken`) 시 회수 흐름 ③ 미등록 민트: 민트 추가 후 수신 / 거절 선택 · 수신 리뷰 승인/거절 동작 | `onBack`→previousScreen ‖ token(리뷰·토큰 상태 클리어) · `onComplete`→token · 리뷰 거절 확정→previousScreen ‖ home |
| 20 | `token-detail` | TokenScreen `onSelectToken`(previousScreen='token') **[state 가드: selectedTokenDetail — 없으면 오버레이 미표시, 베이스 TokenScreen만]** | ① 우측 슬라이드 인 오버레이(spring) — 베이스 TokenScreen 리마운트 없음(PageTransition key 공유) ② 공유(navigator.share/클립보드 폴백) ③ 회수(`onReclaim`) 성공 시 복귀 + 토스트 / 내역 삭제 동작 | `onClose`→token(오버레이 슬라이드 아웃) · `onReclaim` 성공→handleBack · `onTriggerEasterEgg`→token-easter-egg |
| 21 | `token-easter-egg` | TokenDetail `onTriggerEasterEgg` (previousScreen='token-detail') | ① 사토시 드롭 애니메이션 렌더 ② 화면 탭으로 닫힘 | `onClose`→handleBack→token-detail |

## 전역 UI 상태 4종 (Screen 유니온 밖 — 계획 "25종" 보충)

| # | 상태 | 진입 경로 | 핵심 확인 항목 | 이탈 경로 |
|---|------|-----------|----------------|-----------|
| 22 | 초기화 스플래시 | 앱 시작(isInitializing) | ① ZAPPI 로고 + 스피너 표시 ② 설정/거래/환율 로드 완료 후 해제 | init 완료 → 잠금 화면 또는 메인 |
| 23 | 잠금(LockScreen) | 앱 시작(기본 잠금) / 자동잠금(useAutoLock 타임아웃) | ① PIN 입력 dots + 오답 처리 ② 패스키 사용 가능 시 마운트 직후 자동 트리거 ③ 재잠금 해제 시 세션 유지(재부트스트랩 없음 — 경량 경로) | 잠금 해제 성공 → 메인 앱 |
| 24 | 홈 카메라 스캐너(QrScannerModal) | Home `onScan` | ① 카메라 프리뷰 표시 ② 스캔 결과 라우팅: sendable→send·토큰→token-register·금액→amount-action·npub→해석(ready/민트 선택/에러 토스트)·인식 불가→에러 토스트 | 닫기(onClose) / 스캔 성공 시 자동 닫힘 → 라우팅된 화면 |
| 25 | npub 민트 선택 시트(MintSelectBottomSheet) | 카메라 npub 스캔 해석이 needs-mint-selection일 때 | ① 수신자와의 공통 민트만 필터 표시 ② 선택 시 send로 진입(민트/표시명 주입) | 선택→send / 닫기→시트 해제(화면 잔류) |
