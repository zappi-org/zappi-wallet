# Current Task — ZAP-44

- [x] Confirm wallet repo rules (`CLAUDE.md`, root `AGENTS.md`, `zappi-wallet/AGENTS.md`) and review `tasks/lessons.md`
- [x] Re-check current branch / worktree status and session diff
- [x] Commit ZAP-52/ZAP-253 follow-up work (`f6273ab`, `fix: harden incoming review resolution`)
- [x] Re-prioritize remaining `월렛 알파 준비` issues in Linear and pick the next concrete item (`ZAP-235`)
- [x] Commit ZAP-235 follow-up work (`8d22262`, `fix: prevent duplicate mint names`)
- [x] Re-prioritize remaining `월렛 알파 준비` issues again and pick the next concrete item (`ZAP-44`)
- [x] Inspect mint/relay settings screens and confirm which order-sensitive flows already follow stored array order
- [x] Add mint reorder controls in settings and persist reordered `settings.mints`
- [x] Add relay reorder controls in settings and persist reordered `settings.relays`
- [x] Expose primary-item UI cue for the first mint / relay
- [x] Add focused regression tests for reorder helpers and settings reorder actions
- [x] Run targeted validation for ZAP-44 changes

Review
- Current implementation branch is `fix/zap-44-mint-relay-order`, stacked on top of committed ZAP-235 work from `fix/zap-235-mint-name-uniqueness`.
- `ZAP-238` remains open as an umbrella, but its remaining content is now investigative queue-contention follow-up rather than a clean implementation ticket; `ZAP-44` was the next concrete item that could be shipped immediately.
- Existing order-sensitive flows were already mostly aligned with `settings.mints` / `settings.relays`: receive defaults use `settings.mints[0]`, mint selectors iterate `settings.mints` in-order, and `MainApp.handleSaveSettings` republishes profile data whenever reordered mint/relay arrays change.
- `MintManagementScreen` now lets the user move mints up or down from the expanded card, persists the new array order, and marks the first item as the primary mint.
- `RelayManagementScreen` now lets the user move relays up or down inline, persists the new relay order, and marks the first item as the primary relay.
- Focused validation passed: `bun run test src/__tests__/unit/utils/reorder.test.ts src/__tests__/unit/ui/settings/MintManagementScreen.test.tsx src/__tests__/unit/ui/settings/RelayManagementScreen.test.tsx`, `npx tsc --noEmit`, `bun run lint -- src/utils/reorder.ts src/ui/screens/Settings/MintManagementScreen.tsx src/ui/screens/Settings/RelayManagementScreen.tsx src/i18n/locales/en.ts src/i18n/locales/ko.ts src/i18n/locales/ja.ts src/i18n/locales/es.ts src/i18n/locales/id.ts src/__tests__/unit/utils/reorder.test.ts src/__tests__/unit/ui/settings/MintManagementScreen.test.tsx src/__tests__/unit/ui/settings/RelayManagementScreen.test.tsx`, and `git diff --check`.

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
