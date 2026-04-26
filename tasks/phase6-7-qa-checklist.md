# Phase 6/7 수동 QA 체크리스트

Phase 6/7에서 변경된 모든 화면의 동작 검증.

## Send Flow
- [x] Lightning 주소로 송금
- [x] bolt11 인보이스로 송금
- [x] NUT-18 cashu request로 송금
- [x] 토큰 생성 (금액만 입력, 목적지 없음)
- [x] my-wallet 이체 (cross-mint swap)
- [x] 수수료 표시 정확성
- [x] 라우트 선택 표시 (token transfer, lightning 등)
- [x] 잔액 부족 에러 메시지

## Receive Flow
- [x] Lightning 인보이스 생성 + QR 표시
- [x] NUT-18 HTTP POST 수신
- [x] P2PK 토큰 수신
- [x] ecash 토큰 붙여넣기 수신
- [x] BIP-321 unified QR 표시

## Wallet Alpha Follow-up
- [x] ZAP-52: 미등록 mint gift-wrap 토큰 수신 시 자동 수령되지 않고 review 화면으로 진입
- [x] ZAP-52: review에서 `이 mint 추가하고 수령` 선택 시 linked receive request 완료 + review queue 제거 + POS ACK 유지
- [x] ZAP-52: review에서 미등록 mint 토큰은 `이 mint 추가하고 수령` 또는 `거부`만 제공하고 `내 mint로 스왑하여 수령`을 제공하지 않음
- [x] ZAP-52: review에서 `거부` 선택 시 자동 민트 추가/자동 수령 없이 종료되고 재진입하지 않음
- [x] ZAP-253: pending receive request 상세 진입 시 remote mint가 quote를 모르면 즉시 expired 처리되고 목록에서 제거
- [x] ZAP-253: pending receive request 상세 진입 시 remote mint가 quote를 아직 알면 기존 카운트다운이 유지됨

## Settings
- [x] Lightning 주소 등록
- [x] Username 변경 (무료/유료)
- [x] 잔액 복구 (Restore Tokens)
- [x] POS 디바이스 추가
- [x] 프로필 페이지 npub 표시
- [x] 민트 관리 (추가/삭제)
- [x] 릴레이 관리

## Transaction Detail
- [x] 대기 중 ecash 토큰 reclaim
- [x] 이미 사용된 토큰 "already spent" 메시지
- [x] 트랜잭션 삭제
- [x] 토큰 QR 표시/공유

## Mint Detail
- [x] 민트 상태 표시
- [x] Pending items 표시
- [x] Pending item detail → redeem/reclaim

## Contacts
- [x] Lightning 주소 연락처 추가 + 검증
- [x] npub 연락처 추가 + NutZap 검증
- [x] 연락처에서 송금

## Home
- [x] 잔액 표시
- [x] 트랜잭션 목록 표시
- [x] Pull-to-refresh
- [x] 민트 카드 표시

## General
- [x] 앱 잠금/해제
- [x] 온보딩 플로우 (첫 사용)
- [x] 오프라인 → 온라인 복구
- [x] QR 스캔
