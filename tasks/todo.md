# Current Task — ZAP-253

- [x] Confirm wallet repo rules (`CLAUDE.md`, root `AGENTS.md`, `zappi-wallet/AGENTS.md`) and review `tasks/lessons.md`
- [x] Verify `staging` is synced with `origin/staging`
- [x] Create working branch from `staging` (`fix/zap-52-receiver-scope`)
- [x] Re-check remaining `월렛 알파 준비` Todo / Backlog issues in Linear
- [x] Prevent background receiver paths from auto-registering untrusted mints before user consent
- [x] Route untrusted gift-wrap / recovery tokens into explicit receiver review flow
- [x] Add explicit reject path alongside `add mint and receive` / `swap to my mint`
- [x] Preserve NUT-18 request completion and POS delivery ACK when reviewed token is accepted
- [x] Add regression tests for untrusted incoming queue + trust gating
- [x] Re-prioritize remaining wallet alpha issues after ZAP-52 and pick the next concrete item (`ZAP-253`)
- [x] Add protocol-neutral effective expiry check for pending receive requests
- [x] Add `expireById` cleanup path for receive request + linked transaction records
- [x] Auto-expire UNKNOWN/forgotten pending receive requests on detail open
- [ ] Run full validation: `bun run lint`, `bun run build`, `bun run test`, `npx tsc --noEmit`, `verify-*` audit

Review
- `staging` is at `0/0` against `origin/staging` after `git fetch origin`, and the session branch is `fix/zap-52-receiver-scope`.
- Remaining `월렛 알파 준비` issues are currently `ZAP-52`, `ZAP-44`, `ZAP-238` in `Todo`, plus `ZAP-235`, `ZAP-253`, `ZAP-233`, `ZAP-81` in `Backlog`.
- ZAP-52 receiver root cause was background NIP-17 gift-wrap and recovery paths redeeming unknown mints immediately; this session routes those into explicit review instead.
- ZAP-253 root cause was the receive request UI trusting only local `expiresAt`, while actual counterparty liveness (`UNKNOWN` mint quote) never fed back into request expiry or transaction cleanup.

# Zappi Wallet — Design Overhaul

Design Principles: 신뢰 · 세련 · 편안
References: Toss + Apple Wallet

## Phase 1: Normalize (일관성) ✅
- [x] ScreenHeader: aria-label i18n
- [x] bg-black/[0.04] → bg-foreground/[0.04] (4 files)
- [x] aria-label "Back"/"Close" 하드코딩 → i18n
- [x] bounce-slow → float-slow (smooth easing)

## Phase 2: Arrange (Home 위계) ✅
- [x] 잔액 영역 — "Total" 라벨 축소, 숫자 주인공, baseline 정렬
- [x] 카루셀 간격 축소 (pt-10 pb-8 → pt-6 pb-6)
- [x] 액션 버튼 그림자 정리

## Phase 3: Distill (Settings 구조) ✅
- [x] PIN 변경: 모달 → 풀스크린 페이지 전환
- [x] auto-submit useEffect로 수정
- [x] LockScreen PIN dots transition 추가

## Phase 4: Delight + Animate ✅
- [x] SendCompleteStep: confetti 추가
- [x] ReceiveCompleteStep: spring 이미지 모션 + confetti 추가

## Phase 5: 전체 디자인 감사 ✅
- [x] strokeWidth 통일 (2 → 1.8, 차트 제외)
- [x] 터치 타겟 < 44px 수정 (MintMgmt, RelayMgmt, AddMint)
- [x] active:scale-90 → 95 (5 files)
- [x] active:scale-[0.97] → [0.98] (3 files)
- [x] 모든 화면 헤더 패턴 통일 (ScreenHeader 기준: px-5, h-14, w-10 h-10 back button, text-subtitle title)
  - [x] SettingsScreen
  - [x] SettingsDetailPage (Language, Fiat, AutoLock 등)
  - [x] HistoryScreen
  - [x] TransferScreen
  - [x] PendingItemsScreen
  - [x] MintManagementScreen
  - [x] RelayManagementScreen
  - [x] AddMintScreen
  - [x] AnalyticsScreen
  - [x] NotificationsScreen
  - [x] UsernameChangeScreen
  - [x] OnboardingScreen (mnemonic + pin steps)
- [x] 타이포 적절성 검사
  - [x] AnalyticsScreen: text-body → text-subtitle, text-overline → text-label
  - [x] NotificationsScreen: text-body → text-subtitle, text-label → text-body
  - [x] MintDetailScreen: text-label → text-caption (section headings)

## Onboarding 개선 ✅
- [x] "지갑 복구" 밑줄 텍스트 → outline 버튼
- [x] Mnemonic 워드 그리드: 가로 순서 → 세로 순서 (grid-flow-col)

## 남은 작업
- [ ] 투명도 표기 통일 (/[0.1] → /10 등)
- [ ] border-radius 정리 (후순위)
- [ ] 그림자 패턴 정리 (후순위)
- [ ] Phase 5 최종 Polish
