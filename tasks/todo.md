# Current Task — Header Typography Unification

- [x] Use the Token tab `이캐시` title typography (`text-heading font-bold`) for other screen headers
- [x] Preserve existing header layout/positioning; only the title text style changes
- [x] Remove duplicate safe-area offset from floating bottom navigation and Token toolbar
- [x] Apply ZAP-266 current-month per-day timeline grouping to Token and History timelines
- [x] Verify lint/typecheck/test/build before completion

Plan
- Do not convert centered navigation headers into Token tab's left-aligned tab header. Back buttons and right actions should stay where they are.
- Update common header components first, then screen-local full-screen headers that do not go through the shared component.
- Add truncation/padding only to centered absolute titles so the larger typography cannot overlap header actions.

Review
- Screen headers now use the Token tab title typography (`text-heading font-bold text-foreground`) while preserving their existing left/center/right layout.
- Centered absolute headers keep action-safe horizontal padding and truncation so longer localized titles do not overlap back/action buttons.
- Modal/body section titles were intentionally left alone; this pass only targets screen-level headers and full-screen scanner/processing headers.
- Home itself did not have bottom `pb-safe`; the visible bottom gap came from floating nav/toolbars adding `env(safe-area-inset-bottom)` to their `bottom` position. Both now use the same fixed 4px bottom offset.
- ZAP-266 grouping now splits current-month items after yesterday into `dayThisMonth` day groups, while prior months in the current year remain monthly groups. Token and History rows both show `HH:MM` for those day groups.
- Verification passed: `bun run lint`, `npx tsc --noEmit`, `bun run test`, `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, and `git diff --check`.

# Current Task — History Timeline Polish + PWA Update Check

- [x] Change non-CJK timeline month anchors from long month names to localized short month names
- [x] Add a manual PWA update check entry point in Settings without auto-installing updates
- [x] Verify lint/typecheck/test/build before completion

Plan
- Keep Korean/Japanese/Chinese month anchors as numeric month labels, and use `Intl.DateTimeFormat(..., { month: 'short' })` only for languages that previously rendered long month names.
- Place manual update check near the app version/logout area in Settings, matching OS-style app maintenance placement rather than mixing it into wallet settings categories.
- Manual check must not call `updateSW()` directly. It should only detect a waiting service worker, mark `updateAvailable`, and let the existing explicit update action install the new version.

Review
- History and Token timeline month anchors now use localized short month names for non-CJK languages (`Mar`, `dic`, `Des`, etc.), while Korean/Japanese/Chinese keep the numeric month format.
- Settings now has a manual `업데이트 확인` action in the app maintenance/version area. The button checks the registered service worker and shows a spinner while checking.
- Manual update check does not immediately install or reload. If an update is found, it only marks `updateAvailable`; Settings then replaces the check button with one explicit `새 업데이트가 있습니다` install action in the same app maintenance area.
- The old top-of-settings update banner was removed so manual check, update-available state, and update install action all live in one consistent location.
- Verification passed: `bun run lint`, `npx tsc --noEmit`, `bun run test`, `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, and `git diff --check`.

# Current Task — History Timeline Design

- [x] Reproduce and fix current `bun run lint` hook dependency warnings before UI work
- [x] Compare Token tab timeline design with current History transaction list structure
- [x] Add a History-specific timeline card row that reuses existing transaction title/subtitle/amount semantics
- [x] Rework History screen grouping to use the Token tab date-anchor visual language while preserving filters, mint names, export, and transaction detail navigation
- [x] Align transaction wording with the eCash terminology pass and make history icons represent money direction rather than protocol
- [x] Verify lint/build/typecheck and document remaining build-only bundle warnings separately

Plan
- Do not copy Token row semantics directly. Token history has token-specific states (`registered`, `consumed`, `reclaimed`), while wallet history must preserve Lightning/eCash/swap titles, sources, mint routes, pending/failed styling, and fiat snapshots.
- Use the existing `groupTransactionsForTimeline` date grouping helper so History and Token share the same date grouping model.
- Keep virtualization at the group level to avoid replacing the current scalable list with a fully unvirtualized list.
- Keep all changes in UI/hooks only; no domain, service, adapter, or storage behavior should change for this design update.

Review
- The original two ESLint warnings in `SendInputStep.tsx` were fixed by correcting hook dependency arrays; `bun run lint` now reports no warnings.
- `HistoryTimelineRow` was added as a history-specific card row instead of reusing the token row directly, so wallet-history semantics still preserve Lightning/eCash/swap titles, source/destination details, amount signs, fiat snapshots, pending/failed indicators, and linked swap route metadata.
- `HistoryScreen` now renders filtered transactions through `groupTransactionsForTimeline`, using a Token-tab-style left date anchor with right-side rounded transaction cards. Filters, search, mint filtering, export, and transaction detail navigation remain wired to the existing History screen state.
- Transaction wording now prioritizes the money action: `수신 (라이트닝)`, `전송 (라이트닝)`, `수신 (이캐시)`, `전송 (이캐시)`, with Cashu-token lifecycle entries shown as `생성 (이캐시)`, `등록 (이캐시)`, and `되찾기 (이캐시)`. These labels flow through Home and Mint Detail transaction lists because they share `transactionHelpers`.
- Transaction rows now put date/time first in subtitles, omit the repeated type label when the title is already the same label, and keep route/source/destination context after the date/time for metadata-rich rows.
- History timeline icons now represent direction/action: receive arrow, send arrow, swap, and reclaim. Normal icon color follows the displayed amount sign (`+` uses primary, `-` uses foreground), while pending/failed states keep their status colors. Lightning/eCash protocol is kept in text only to avoid confusing the primary money movement.
- Tab screens no longer reserve large blank bottom padding; the fixed bottom navigation/Token toolbar owns the safe-area offset, while Home/Token/Contacts/Settings content keeps only minimal end padding.
- Verification passed: `npx tsc --noEmit`, `bun run lint`, focused timeline tests (`29` tests), `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, `git diff --check`, and manual hack/hardcoding/unsafe-HTML search in touched UI paths.
- Build still emits pre-existing Vite bundle warnings about mixed dynamic/static imports and large chunks. Those are bundling optimization issues and were not mixed into this UI design patch.

# Current Task — ZAP-81

- [x] Confirm wallet repo rules (`CLAUDE.md`, root `AGENTS.md`, `zappi-wallet/AGENTS.md`) and review `tasks/lessons.md`
- [x] Re-check current branch / worktree status and session diff
- [x] Commit ZAP-52/ZAP-253 follow-up work (`f6273ab`, `fix: harden incoming review resolution`)
- [x] Commit ZAP-235 follow-up work (`8d22262`, `fix: prevent duplicate mint names`)
- [x] Commit ZAP-44 follow-up work (`a97cb52`, `feat: support mint and relay ordering`)
- [x] Commit ZAP-233 follow-up work (`069acb1`, `feat: allow force deleting mints`)
- [x] Re-prioritize remaining `월렛 알파 준비` issues again and pick the next concrete item (`ZAP-81`)
- [x] Inspect `SwapService` drain retry flow and confirm where abandoned mint quotes remain pending in Coco
- [x] Add a swap-quote cleanup hook so composition can abandon orphan target quotes through the Cashu layer
- [x] Update drain retry flow to abandon replaced quotes and cancel their receive-completion waits before re-quoting
- [x] Cover both successful drain retry cleanup and early drain budget failure cleanup with focused regression tests
- [x] Run targeted validation for ZAP-81 changes
- [x] Re-plan the ZAP-81 corrective rework after the rule review flagged the old `'ISSUED'` workaround as non-root-cause
- [x] Re-audit the corrected implementation against `CLAUDE.md`, root `AGENTS.md`, wallet `AGENTS.md`, and `tasks/lessons.md`
- [x] Re-run full wallet verification before moving on: `bun run lint`, `bun run build`, `bun run test`, `npx tsc --noEmit`, `git diff --check`, and `verify-*` status check

Review
- Current implementation branch is `fix/zap-81-drain-quote-cleanup`, stacked on top of committed ZAP-233 work from `fix/zap-233-force-delete-mint`.
- `ZAP-81` is the next low-risk wallet-alpha cleanup item because the issue is tightly scoped to drain retry behavior inside `SwapService`, and the existing `SwapQuoteMarker` port already provided the correct composition seam.
- The root problem was that drain mode only called `unmark()` when replacing the first receive quote, so Coco still kept the old mint quote and mint operation pending until invoice expiry.
- `SwapQuoteMarker` still provides `abandon(accountId, quoteId)`, but the Cashu composition now maps that to an atomic Coco cleanup helper that directly deletes the abandoned mint quote row and its linked mint operations instead of overloading the quote state with `ISSUED`.
- `SwapService` now treats cleanup as part of the drain retry contract: it abandons the superseded quote before creating a replacement quote, cancels the stale `onReceiveCompleted` subscription/timeout, and fails fast if cleanup cannot complete.
- Early drain-budget exits preserve their original failure reason and append cleanup detail only when abandonment itself fails, so the retry path no longer hides the underlying balance/drain cause.
- Quote cleanup tracking is now quote-scoped, so if a later replacement quote fails before `executeSend`, the newest quote is still cleaned up rather than being left marked/pending.
- Full verification is now documented per `tasks/lessons.md`: `bun run lint`, `bun run build`, `bun run test`, `npx tsc --noEmit`, rule audit against `CLAUDE.md` + both `AGENTS.md` files + `tasks/lessons.md`, `git diff --check`, and `verify-*` status check (`rg --files | rg '(^|/)verify-'` returned no matches in this workspace).
- Design and review were both re-run with specialist agents after the rework; the final rule-audit review found no remaining rule violations in the touched files.
- Full build passed after fixing a `swap.service.test.ts` mock typing regression caught by `tsc -b`; build still emits the existing Vite chunk-size warnings, but no new build failures were introduced by the ZAP-81 changes.
- Next likely investigation track remains `ZAP-238`, unless fresh local repro points to a more urgent wallet-alpha blocker.

# Current Task — ZAP-238

- [x] Freeze new implementation until the prior ZAP-81 rule audit is fully rerun and documented
- [x] Re-read Linear `ZAP-238` scope and inspect the current pending-recovery paths (`App.tsx`, `MainApp.tsx`, `payment.service.ts`, `cashu-recovery.ts`, `coco-sdk.ts`)
- [x] Confirm the likely bottleneck order: stale pending quote cleanup first, queue separation only if delay remains after cleanup
- [x] Align onboarding recovery wiring with the active-mint filtering already used by the normal Cashu backend path
- [x] Replace mint-quote recovery expiry handling so it prefers real `expiresAt`, keeps the 24h fallback only for legacy records, and reports `expired` separately from `failed`
- [x] Add regression coverage for inactive/deleted mint filtering, real-expiry cleanup, legacy fallback expiry, and onboarding recovery wiring
- [x] Run focused verification for ZAP-238 changes and then a separate review-agent pass before calling it done

Review
- `composition/recover-pending-quotes.ts` now forwards an authoritative mint list from onboarding recovery, so the pre-bootstrap recovery path matches the active-mint filtering already used by the normal Cashu backend flow.
- `cashu-recovery.ts` now distinguishes `activeMintUrls === undefined` from an explicit `[]`, treats `expiresAt` as the primary expiry signal, keeps the 24h age fallback only for legacy records without expiry metadata, and reports `expired` separately from `failed` while still moving expired transactions out of pending.
- `create-cashu-backend.ts` is covered by a dedicated unit test so the `undefined` vs `[]` semantics stay locked at the factory seam.
- Queue separation remains intentionally out of scope for this patch; the current fix addresses stale pending quote cleanup first, and unlock/resume contention should only be split further if it still reproduces after this change lands.
- Validation rerun for this patch: targeted recovery/composition/backend tests, `bun run test` (67 files / 503 tests), `bun run build`, `npx tsc --noEmit`, code-file `bun run lint -- ...`, and `git diff --check`.

# Current Task — Wallet Alpha QA Follow-up

- [x] Reconfirm rules and current branch/worktree before touching QA fixes
- [x] Fix cross-mint token receive so failed swaps only claim/add a source mint when funds actually landed there
- [x] Fix swap transaction row subtitles so they never show an empty or dangling mint route
- [x] Keep BIP-321 request receive classification as-is if Lightning was the actual paid rail, and document that expectation
- [x] Replace mint/relay ordering controls with a production-grade reorder interaction: visible drag handle plus keyboard/button fallback
- [x] Add focused regression coverage for the above behavior
- [x] Rework QA feedback after manual testing: remove duplicate swap-failure toast, stop implicit source-mint additions, and replace misleading recovery copy
- [x] Fix review-blocker: keep Coco receive/redeem trust operation-scoped for source mints outside user settings, and only persist trust after explicit mint-add action
- [x] Remove the old visible up/down reorder buttons while preserving keyboard reordering on the drag handle
- [x] Simplify unknown-mint token receive UX to only allow explicit mint add-and-receive or reject, removing receive-to-my-mint swap from that branch
- [x] Run verification and a final rule audit before considering the QA follow-up complete
- [x] Reflect completed manual QA confirmation in `tasks/phase6-7-qa-checklist.md`

Review
- QA item 1 was a display fallback bug: swap rows with incomplete metadata could render a dangling `source mint →` route. `TransactionRow` now only renders `from → to` when both mints are known and otherwise falls back to the swap label.
- Swap transaction rows now use the same `source mint → target mint` title for both the source-side send transaction and the target-side receive transaction; the subtitle carries the generic swap type.
- Source-side swap rows were still falling back to `swap` after settlement because fee updates replaced transaction metadata and dropped `fromMintUrl/toMintUrl`. `DexieTransactionRepository.update()` now merges metadata, and rows can recover route metadata from the linked counterpart for already-written transactions.
- QA item 2 is expected behavior: the generated BIP-321 request exposes both Lightning and eCash options, so if Cashume pays the Lightning invoice, the wallet should record it as a Lightning receive.
- QA item 3 was simplified at the product level: unknown-mint token receive no longer offers `receive to my mint` swap, because the convenience path creates confusing failure/recovery states for tiny tokens and can turn a simple reject/add decision into an already-redeemed recovery problem. Unknown-mint tokens now only offer explicit mint add-and-receive or reject. The lower-level cross-mint token swap path remains for already-configured mints.
- Coco's direct receive fee shortfall (`Receive amount is not sufficient after fees`) is now classified as `REDEEM_FEE_TOO_HIGH` at the Cashu boundary, preserved by `PaymentService`, and translated by Receive UI instead of leaking raw SDK English.
- Registered-mint token confirmation now exposes only `original mint receive` or `do not receive` before redeeming. Unconfigured mint tokens expose `add mint and receive` or `do not receive`; both paths use the same reject wording.
- `SwapService.estimateSwap()` now abandons its temporary target quote after fee estimation, including failure cleanup, so the new preflight path does not reintroduce stale quote debt.
- Swap route estimation failures now use `SWAP_ESTIMATE_FAILED` instead of pretending every estimate failure is a fee-too-high case.
- Coco receive/redeem still uses the trust state Coco requires internally, but now scopes that trust to the operation when the token source mint is outside `settings.mints`; the source mint is restored to untrusted state after estimate/redeem and only becomes persistent trusted state through explicit user mint-add confirmation.
- QA item 4 now uses a visible drag handle for mint/relay ordering. The original up/down buttons were removed; keyboard users can focus the handle and use the up/down arrow keys. Save failures roll back the local order and show an error toast.
- Focused verification passed after the QA rework: `bun run test:run` for swap receive, unknown-mint receive UI, event-store bridge, receive-flow swap recovery, and mint/relay settings tests.
- Full verification passed after the final QA rework: `bun run lint`, `npx tsc --noEmit`, `bun run test -- --run` (72 files / 548 tests), `bun run build`, and `git diff --check`. Build still emits the existing Vite chunk/dynamic import warnings.
- Final specialist review found three completion blockers and they were fixed before this task was treated as complete: source-mint trust restoration failures now fail loudly instead of being logged as best-effort cleanup, swap estimate quote cleanup keeps/report its quote id until abandonment succeeds, and the new Cashu internal tests were moved inside `src/modules/cashu/internal` so the new tests no longer import `internal/` from outside.
- Final rule audit included untracked new files, architecture import-boundary searches, sensitive-term searches, hack/workaround searches, `.js` import-extension checks, and `verify-*` discovery. `verify-*` files remain absent in this workspace.

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

# Current Task — ZAP-173

- [x] Re-read root `CLAUDE.md`, root `AGENTS.md`, wallet `AGENTS.md`, and `tasks/lessons.md`
- [x] Re-read Linear `ZAP-173` and confirm the current code only has a single ReceiveRequest status model
- [x] Create dedicated branch `fix/zap-173-receive-request-lifecycle` from clean `staging`
- [x] Ask specialist agents for implementation design and security/hexagonal-rule risk review before coding
- [x] Replace single ReceiveRequest status with domain-level `fulfillmentStatus` and per-method `status`
- [x] Add pure domain transitions: fulfill by method, expire method/request, cancel request, receive additional method
- [x] Update receive request ports/services/repository so state transitions go through the domain, not UI/store/Dexie shortcuts
- [x] Preserve legacy Dexie compatibility while making `paymentMethods` the canonical persisted method state
- [x] Stop `PaymentService.receive()` from creating premature pending receive transactions
- [x] Normalize ReceiveRequest lifecycle method identifiers to `bolt11` / `ecash` while preserving BIP-321 `lightning` URI naming
- [x] Hide fulfilled ReceiveRequests from pending UI without deleting method state or cancelling transactions
- [x] Cover duplicate settlement, additional-method settlement, expiry, legacy mapping, and no-premature-TX behavior with tests
- [x] Run full verification: focused tests, `bun run lint`, `npx tsc --noEmit`, `bun run test -- --run`, `bun run build`, and `git diff --check`
- [x] Run final specialist audit and only complete Linear if no security, rule, hardcoding, workaround, or hexagonal-boundary issue remains

Review
- ZAP-173 must not be solved by setting `status = completed` and hiding symptoms. The root fix is a domain lifecycle split: request fulfillment is UI-level completion, method status tracks each payment method independently.
- Core must stay pure/inward-only; Dexie, Coco, Zustand, i18n, and UI logic remain outside the hexagon.
- Transaction deletion/cancellation is not the primary fix. Fulfilled requests are hidden by ReceiveRequest fulfillment state while method state is retained for duplicate/additional settlement handling.
- Implementation now stores canonical `paymentMethods` with method-level status in Dexie while still reading legacy flat records (`status`, `quoteId`, `ecashRequestId`, `completedMethod`).
- `EventStoreBridge` no longer performs raw Dexie ReceiveRequest lifecycle writes; it forwards settlement signals to `ReceiveRequestUseCase.settleByPaymentRef`.
- `PaymentService.receive()` no longer writes pending receive transactions before settlement. Actual receive transactions continue to be recorded by settlement paths.
- Trusted gift-wrap receive now records ReceiveRequest lifecycle before marking the event processed. If redeem succeeds but lifecycle persistence fails, the failed-incoming queue keeps the ReceiveRequest ref/method so recovery can retry the lifecycle write without re-redeeming an already-spent token.
- Receive QR creation now persists the canonical ReceiveRequest before adding the legacy pending quote or showing a payable QR. If persistence fails, the flow shows an error and does not expose the request.
- Verification passed: focused ZAP-173 tests, `bun run test -- --run` (78 files / 577 tests), `bun run lint`, `npx tsc --noEmit`, `bun run build`, and `git diff --check`.
- Final specialist audit found no blockers and no security, rule, hexagonal-boundary, hardcoding, or workaround violations. The audit included untracked new files, `verify-*` discovery, core import-boundary search, raw ReceiveRequest Dexie write search outside the adapter, `modules/cashu/internal` diff additions, TODO/HACK/workaround/hardcoding/sensitive diff search, and `tasks/lessons.md` review.

# Current Task — Hex Boundary Cleanup

- [x] Create dedicated branch `refactor/hex-boundary-cleanup` from clean `staging`
- [x] Re-read root `CLAUDE.md`, wallet `AGENTS.md`, and `tasks/lessons.md`
- [x] Confirm `hex-review` skill location and execute it via subagent, not inline
- [x] Design a root-cause refactor for all known import-boundary violations, including manual `AGENTS.md` findings
- [x] Validate the design with a specialist agent before implementation
- [x] Remove UI → composition and composition → UI/service violations without `hex-ignore`
- [x] Remove adapter → store, adapter → modules, and adapter → composition violations through ports/dependency injection
- [x] Re-check `modules/cashu/internal` imports and either move tests inside the boundary or route production code through public seams
- [x] Run `hex-review`, manual architecture searches, sensitive/hack/hardcoding searches, lint, typecheck, test, build, and `git diff --check`
- [x] Fix manual-QA token reclaim regressions: observer/UI race false failure and reclaim success toast wording
- [x] Run final specialist audit and only then decide whether the branch is complete

Review
- `hex-review` reports 3 import violations, but they collapse to 2 implementation tasks: `use-cross-tab-sync` imports composition from UI, and `bootstrap` imports `ui/services/balance-cache`.
- Manual `AGENTS.md` review adds stricter adapter-boundary work that the script does not currently check: adapters must not import store, UI, services, or hooks, and should depend inward through core ports or be wired from composition.
- `cross-tab-sync` now lives in `utils/` as a cross-cutting browser primitive, so UI no longer imports composition.
- `balance-cache` now has a core port and localStorage adapter; bootstrap wires the adapter instead of importing a UI service.
- Cashu fee estimation and send-token SDK operations now live under `modules/cashu/adapters` with `cashuBackend` injection. Proof-state checks were also moved behind the backend seam after specialist review. Transaction finalization/reclaim state changes moved into `TransactionMgmtService` using repositories and domain events.
- Runtime adapters no longer import Zustand; bootstrap injects settings/review queue closures.
- `recover-pending-quotes` now routes through `createCashuBackend()` rather than importing Cashu internals, and internal Cashu tests were moved inside `src/modules/cashu/internal`.
- Verification passed: `hex-review`, manual architecture import searches, `bun run lint`, `npx tsc --noEmit`, `bun run test -- --run` (79 files / 582 tests), `bun run build`, and `git diff --check`. After the proof-state seam follow-up, `bun run lint`, `npx tsc --noEmit`, `hex-review`, focused regression tests, manual boundary searches, and `git diff --check` were rerun. Build still emits existing Vite chunk/dynamic import warnings.
- Final specialist reviews reported no blockers and approved the requested scope. One non-blocking backend-injection concern was addressed before this task was considered complete.
- Manual QA found two token reclaim regressions. The detail-screen failure toast was caused by a real observer/UI race: the Coco rollback event could mark the send as reclaimed before the button path recorded the same state. `TransactionMgmtService.reclaimSendToken()` now validates the source tx before any SDK side effect, handles already-reclaimed races idempotently, and does not hide local record failures.
- Token-created screen no longer routes reclaim through `PaymentService.reclaim()`/`payment:completed`; it uses the send-token lifecycle path and shows `{{amount}} 회수 완료`.
- Follow-up audits found and fixed deeper reclaim issues before completion: token-only legacy reclaim now actually reclaims proofs through the Cashu backend receive path before recording history, records the backend net amount/fee/accountId, refuses missing/non-send/non-reclaimable source txs without mutating wallet state, and hides the detail reclaim action after successful/already-reclaimed state.
- Reclaim follow-up verification passed: focused reclaim tests (3 files / 16 tests), `npx tsc --noEmit`, `hex-review`, `bun run lint`, `bun run test -- --run` (81 files / 593 tests), `bun run build`, and `git diff --check`. Build still emits the existing Vite chunk/dynamic import warnings.
- Final specialist audit reported no blockers for the token reclaim path and confirmed no security, hardcoding/workaround, or hex-boundary issues in the touched files.
