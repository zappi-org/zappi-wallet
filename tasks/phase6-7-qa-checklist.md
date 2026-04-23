# Phase 6/7 수동 QA 체크리스트

Phase 6/7에서 변경된 모든 화면의 동작 검증.

## Send Flow
- [ ] Lightning 주소로 송금
- [ ] bolt11 인보이스로 송금
- [ ] NUT-18 cashu request로 송금
- [ ] 토큰 생성 (금액만 입력, 목적지 없음)
- [ ] my-wallet 이체 (cross-mint swap)
- [ ] 수수료 표시 정확성
- [ ] 라우트 선택 표시 (token transfer, lightning 등)
- [ ] 잔액 부족 에러 메시지

## Receive Flow
- [ ] Lightning 인보이스 생성 + QR 표시
- [ ] NUT-18 HTTP POST 수신
- [ ] P2PK 토큰 수신
- [ ] ecash 토큰 붙여넣기 수신
- [ ] BIP-321 unified QR 표시

## Wallet Alpha Follow-up
- [ ] ZAP-52: 미등록 mint gift-wrap 토큰 수신 시 자동 수령되지 않고 review 화면으로 진입
- [ ] ZAP-52: review에서 `이 mint 추가하고 수령` 선택 시 linked receive request 완료 + review queue 제거 + POS ACK 유지
- [ ] ZAP-52: review에서 `내 mint로 스왑하여 수령` 선택 시 linked receive request 완료 + review queue 제거 + 결과 잔액 표시
- [ ] ZAP-52: review에서 `거부` 선택 시 자동 민트 추가/자동 수령 없이 종료되고 재진입하지 않음
- [ ] ZAP-253: pending receive request 상세 진입 시 remote mint가 quote를 모르면 즉시 expired 처리되고 목록에서 제거
- [ ] ZAP-253: pending receive request 상세 진입 시 remote mint가 quote를 아직 알면 기존 카운트다운이 유지됨

## Settings
- [ ] Lightning 주소 등록
- [ ] Username 변경 (무료/유료)
- [ ] 잔액 복구 (Restore Tokens)
- [ ] POS 디바이스 추가
- [ ] 프로필 페이지 npub 표시
- [ ] 민트 관리 (추가/삭제)
- [ ] 릴레이 관리

## Transaction Detail
- [ ] 대기 중 ecash 토큰 reclaim
- [ ] 이미 사용된 토큰 "already spent" 메시지
- [ ] 트랜잭션 삭제
- [ ] 토큰 QR 표시/공유

## Mint Detail
- [ ] 민트 상태 표시
- [ ] Pending items 표시
- [ ] Pending item detail → redeem/reclaim

## Contacts
- [ ] Lightning 주소 연락처 추가 + 검증
- [ ] npub 연락처 추가 + NutZap 검증
- [ ] 연락처에서 송금

## Home
- [ ] 잔액 표시
- [ ] 트랜잭션 목록 표시
- [ ] Pull-to-refresh
- [ ] 민트 카드 표시

## General
- [ ] 앱 잠금/해제
- [ ] 온보딩 플로우 (첫 사용)
- [ ] 오프라인 → 온라인 복구
- [ ] QR 스캔
