# Current Task — npub Outgoing Pending/Reclaim State Fix

- [x] Reproduce from code path why npub sent-before-claim shows `상태 확인 실패`
- [x] Fix Cashu proof-state normalization so unclaimed outgoing tokens remain claimable
- [x] Treat pending/ambiguous proof transitions as non-failure waiting state
- [x] Recover stale `pending_publish` records so interrupted npub sends do not stay stuck
- [x] Fix `UNKNOWN` error i18n mapping so raw `errors.unknown` is not shown
- [x] Add regression tests for uppercase Cashu proof states and unknown-error mapping
- [x] Run focused tests, full tests, typecheck, lint, build, hex-review, and diff checks

Review
- Root cause: `cashu-ts` returns proof states as enum values such as `UNSPENT`, `SPENT`, and `PENDING`, but our Cashu backend adapter was passing those values through as-is while the outgoing claim-state adapter expected lowercase `unspent`, `spent`, and `pending`.
- Impact: an unclaimed npub/eCash send could be misread as `unknown`, which made Home Transaction Detail show `상태 확인 실패` even though the recipient had not received it yet. `PENDING` and mixed transition states are now treated as non-failure waiting states, and transient `unknown` checks no longer overwrite the visible status with failure.
- Fix: normalize Cashu proof states at the Cashu backend boundary before reporting them to the lifecycle adapter. This keeps proof/SDK details inside the Cashu module boundary.
- Recovery fix: if the app stops after token creation but before relay publish status is saved, a stale `pending_publish` lifecycle row is moved to recoverable `unknown` delivery after the configured grace window instead of remaining permanently unreclaimable.
- Also fixed `UnknownError` i18n mapping from missing `errors.unknown` to existing `errors.unknownError`, so reclaim failures no longer show a raw translation key.
- Verification passed: focused proof/lifecycle/reclaim/detail/token/error tests, `npx tsc --noEmit`, `bun run lint`, full `bun run test` (107 files / 744 tests), `bun run build`, wallet `hex-review` (589 files / 0 violations), targeted security/hardcoding scan, and `git diff --check`.

# Current Task — Live Outgoing eCash Claim Detection

- [x] Confirm why npub sends remain `전송됨 · 수령 대기` until resume/restart
- [x] Add foreground-only outgoing eCash claim polling through the driving port
- [x] Add hook tests for interval, visibility, offline/hidden guards, and in-flight dedupe
- [x] Run focused tests, typecheck, lint, build, and diff checks

Design
- There is no mint/relay push that tells the sender when the recipient spends the token. The app must periodically ask the outgoing lifecycle use case to reconcile open outgoing eCash.
- Polling must run only when the wallet is unlocked, app is visible, online, and Cashu initialization has completed.
- Polling must call only `OutgoingEcashLifecycleUseCase.reconcileOpen()` from UI; proof/mint details stay inside the Cashu adapter and core lifecycle service.
- Prevent overlapping checks with an in-flight guard, and do not run while hidden/backgrounded.

Review
- Added a foreground-only outgoing eCash reconcile poller. While the wallet is unlocked, online, visible, and Cashu init has completed, it calls `outgoingEcashLifecycle.reconcileOpen()` every 15 seconds.
- The poller does not inspect tokens, proofs, mints, or SDK state directly. It calls only the existing driving port, so Cashu proof/claim logic remains inside the lifecycle service and Cashu adapter.
- Added guards for offline, hidden/background, disabled app state, and overlapping checks.
- Transaction Detail now listens to the global transaction refresh signal and reloads the current transaction plus outgoing lifecycle status, so a user who stays on the detail screen can see `전송됨 · 수령 대기` change after polling detects claim.
- Tests added/updated for active polling, hidden/offline no-op, visibility resume check, in-flight dedupe, and detail refresh after transaction changes.
- Verification passed: focused tests, `npx tsc --noEmit`, `bun run lint`, full `bun run test` (105 files / 740 tests), `bun run build`, `hex-review` (589 files / 0 violations), targeted security/hardcoding scan, and `git diff --check`.

# Current Task — eCash Pending Reclaim Service Context Fix

- [x] Identify why pending eCash detail reclaim shows `errors.serviceNotReady`
- [x] Move shared reclaim execution out of React Context-only hook
- [x] Use explicit `serviceRegistry` for `MainApp`-owned reclaim callbacks
- [x] Add/adjust focused tests for the shared reclaim execution path
- [x] Run focused tests, typecheck, lint, and diff checks

Design
- Root cause: `MainApp` calls `useReclaim()` before it renders its own `ServiceProvider`, so that hook cannot read the `ServiceContext` even after `serviceRegistry` exists.
- Fix direction: keep `useReclaim()` for child components that are actually under `ServiceProvider`, but extract the execution logic into a registry-driven UI action. `MainApp` callbacks should pass the existing `serviceRegistry` explicitly.
- Do not move Cashu/Reclaim implementation into UI, do not import adapters/modules from UI, and do not add fallback/hardcoded behavior.

Review
- Fixed the pending eCash detail reclaim path. `MainApp` no longer calls `useReclaim()` outside the `ServiceProvider` it renders; `MainApp`-owned reclaim callbacks now call a shared registry-driven `reclaimTransaction()` action with the existing `serviceRegistry`.
- `useReclaim()` still works for child components that are actually inside `ServiceProvider`; it now delegates to the same shared action, so reclaim behavior stays consistent across Token tab, Token detail, Mint detail pending items, and Transaction detail.
- Added localized `errors.serviceNotReady` fallback so a raw i18n key is not shown if a real startup race happens in the future.
- Removed token/transaction object debug logs from the Token tab/detail path because pending token metadata may include raw Cashu token strings.
- Verification passed: focused reclaim/token tests, `npx tsc --noEmit`, `bun run lint`, full `bun run test` (104 files / 735 tests), and `git diff --check`.

# Current Task — Outgoing eCash Lifecycle Saga Design

- [x] Re-check root and wallet architecture rules before designing
- [x] Inspect existing transaction, reclaim, pending-token, route-execution, and Coco send-observer flows
- [x] Redesign outgoing lifecycle so proof-level details stay inside the Cashu SDK/adapter boundary
- [x] Re-review IncomingInbox against live/catch-up/review/recovery requirements and fix catch-up review source metadata
- [x] Implement outgoing eCash lifecycle domain, store, service, Cashu claim-state adapter, and composition wiring
- [x] Wire token creation and direct npub/nprofile send delivery into the outgoing lifecycle
- [x] Replace generic outgoing eCash `처리중` detail status with lifecycle-derived user states
- [x] Re-run focused tests, full validation, hex-review, security/hardcoding scans, and `git diff --check`

Design
- Existing facts:
  - Sent eCash tokens are already represented as domain transactions with `direction='send'`, `status='pending'`, and `outcome='unclaimed'`.
  - Coco send operations already expose `operationId`, `send:finalized`, and `send:rolled-back`; these can settle transactions as `claimed` or `reclaimed`.
  - `ReclaimService` already rolls back/reclaims by operation id or token and treats "already finalized" as recipient-claimed.
  - Pending-token UI already queries both legacy `pendingSendTokens` and pending `transactions`, but transaction detail still renders generic `처리중` for unclaimed outgoing tokens.
- Principle:
  - Incoming NIP-17/gift-wrap events are handled by `IncomingInbox`.
  - Outgoing token creation and npub/nprofile token delivery must be handled by a separate `OutgoingOutbox` / `OutgoingEcashLifecycle` saga.
  - `Transaction` remains the user-visible ledger. The outgoing lifecycle journal records operational state needed for recovery, proof-state checks, delivery attempts, and idempotency.
  - Core/domain must not model Cashu proof internals. Proof inspection, partial proof interpretation, and Coco operation details stay in the Cashu adapter/SDK boundary.
- Adapter-to-core result contract:
  - The Cashu adapter may inspect proofs, Coco operation state, or mint state, but it reports only protocol-neutral claim-state results to core.
  - Adapter result values: `claimable`, `pending`, `claimed`, `reclaimed`, `unknown`.
  - `claimable` means the outgoing value still appears safely recoverable by the sender.
  - `pending` means the mint reports a non-final proof transition; keep the user-facing waiting state and do not expose proof details.
  - `claimed` means the outgoing value has been consumed/finalized and should be treated as recipient-claimed.
  - `reclaimed` means the sender-side SDK operation has already rolled back/reclaimed and should be treated as sender-recovered.
  - `unknown` means the adapter cannot safely decide due to unavailable data or a transient check failure; it must not overwrite a waiting state as failure by itself.
- Domain states:
  - Delivery state: `not_required`, `pending_publish`, `published`, `publish_failed`, `unknown`.
  - Claim state for the current product scope: `unclaimed`, `checking`, `claim_pending`, `claimed`, `reclaiming`, `reclaimed`, `check_failed`.
  - No `partial`, `mixed`, `proof`, `all_spent`, or `all_unspent` state belongs in core domain for this scope.
  - Final user-visible states are derived from domain state, not from raw `Transaction.status` alone.
- User-visible mapping:
  - Token created and unspent: `수령 대기`.
  - npub/nprofile send published but unspent: `전송됨 · 수령 대기`.
  - Proofs all spent: `수령 완료`.
  - Proofs reclaimed/rolled back: `회수 완료`.
  - Relay publish failed before delivery: `전송 실패`.
  - Proof-state check temporarily unavailable: keep the previous waiting state and retry; do not show `상태 확인 실패` for normal pending/mint transition states.
  - Any adapter-level ambiguous state, including future partial-proof/P2PK ambiguity, maps to a non-failure waiting state for now. Do not expose partial-proof UX in this scope.
- Required ports and services:
  - Add a driven `OutgoingEcashOperationStore` port for operation journal persistence.
  - Add a protocol-neutral driven `OutgoingClaimStateProbe` port that returns only `claimable`, `claimed`, or `unknown`; no cashu-ts, Coco, proof, mint SDK, or Nostr types in core.
  - Add an `OutgoingEcashLifecycleUseCase` driving port with operations such as `recordTokenCreated`, `recordDeliveryAttempt`, `reconcileOpen`, `checkStatus`, `reclaim`, and `markClaimed`.
  - Compose startup/resume recovery through a single `RecoveryCoordinator`, which calls incoming inbox processing and outgoing lifecycle reconciliation without UI importing adapters.
- Lifecycle flow: token creation
  - Prepare and execute Coco send operation.
  - Save transaction as `pending + unclaimed` with token and operation id.
  - Save outgoing lifecycle record with delivery `not_required` and claim `unclaimed`.
  - On detail/open/resume/manual check, ask the adapter for claim state.
  - If adapter returns `claimed`, finalize/mark claimed.
  - If adapter returns `claimable`, keep reclaim available.
  - If adapter returns `unknown`, keep prior terminal state if any, otherwise keep the waiting state and retry without exposing proof details.
  - On reclaim, ask Coco to rollback/reclaim by operation id when available. If mint says already spent/finalized, settle as claimed instead of failing ambiguously.
- Lifecycle flow: direct npub/nprofile send
  - Prepare and execute same-mint token send.
  - Save transaction and outgoing lifecycle record before publishing to relays.
  - Publish NIP-17/NUT-18 delivery and record delivery result separately from claim result.
  - If publish fails, mark delivery `publish_failed` and decide whether immediate reclaim is available.
  - If publish succeeds, show `전송됨 · 수령 대기` until Coco finalization or adapter claim-state check returns `claimed`.
  - Do not treat relay publish success as recipient claim.
- Recovery flow:
  - App unlock/start/resume should run guarded, throttled reconciliation of open outgoing lifecycle records.
  - Reconciliation must be idempotent by `txId` and `operationId`.
  - Reconciliation must never redeem/rollback the same token twice without checking the stored phase and adapter-reported claim state.
  - If the app dies after Cashu operation success but before local DB update, the next run must derive the correct state from Coco operation state and adapter-reported claim state.
  - If the app dies after relay publish or token creation but before local publish status save, stale `pending_publish` reconciliation marks delivery as `unknown` and continues claim-state probing; it must not republish blindly unless the operation is explicitly idempotent.
- Transaction detail requirements:
  - Replace generic `pending` copy for outgoing eCash tokens with derived lifecycle status.
  - Show token copy/QR/share only when the token should still be shareable and not fully reclaimed.
  - Show reclaim CTA only when the claim state is `unclaimed` and the latest adapter result is either `claimable` or not yet contradicted by a failed/unknown check.
  - Provide a manual `상태 확인` action for mint/network check failures.
  - Show npub/nprofile send detail as `전송 (npub)` / `전송 (nprofile)` while status explains delivery/claim state.
- Security and architecture constraints:
  - Never log or toast raw token values, proofs, private keys, nsec, or derived secrets.
  - No hardcoded relay, mint, private key, or recipient values.
  - No direct adapter, module, Dexie, Coco, or cashu-ts import from UI or core services.
  - Ports must remain protocol-neutral; Cashu/Nostr-specific names stay in adapters/composition or explicit metadata only when user-facing labeling requires it.
  - Reclaim/claim resolution must use adapter-reported claim state and Coco operation state as the source of truth, not local UI state.
  - Core code must not contain proof-level terminology or assumptions.
- Migration/backward compatibility:
  - Existing `pendingSendTokens` and `transactions` with `pending + unclaimed` must be projected into lifecycle records lazily or via startup reconciliation.
  - Existing transactions without lifecycle records must still render correctly using current transaction metadata.
  - No destructive migration should remove legacy pending records until the new lifecycle record is confirmed.
- Verification plan:
  - Unit test state derivation for all delivery/claim combinations.
  - Unit test token create lifecycle: unclaimed, claimed, reclaimed, adapter unknown/check failure.
  - Unit test npub send lifecycle: publish failed, published/unclaimed, published/claimed, published/reclaimed.
  - Unit test recovery idempotency for app stop after token creation, after relay publish, during reclaim, and after Coco finalize before DB update.
  - UI tests for Transaction Detail status copy and reclaim/status-check CTA visibility.
  - Run `npx tsc --noEmit`, focused tests, `bun run lint`, `bun run test`, `bun run build`, wallet `hex-review`, hardcoding/security scans, and `git diff --check`.

Review
- IncomingInbox was re-reviewed against the agreed requirements. Live and catch-up paths both persist first, process through `GiftWrapInboxService`, dedupe by event id, preserve `review_pending`, retry stale/failed rows, and route startup/resume catch-up through the same use case.
- One Incoming issue was found and fixed: catch-up untrusted gift-wrap reviews were being enqueued as `source='recovery'`, which could drop npub/gift-wrap metadata after user approval. All GiftWrapInbox review entries now stay `source='gift-wrap'`; fallback legacy recovery remains separate.
- Outgoing eCash lifecycle is now modeled separately from IncomingInbox. `OutgoingEcashLifecycleService` tracks token creation and direct npub/nprofile sends using delivery state plus claim state.
- Core/domain does not model Cashu proof internals. The Cashu adapter inspects token/mint state and reports only `claimable`, `pending`, `claimed`, `reclaimed`, or `unknown` to core. Pending/ambiguous SDK proof transitions keep the user-facing waiting state instead of showing `상태 확인 실패`.
- New outgoing lifecycle records are stored in Dexie (`outgoingEcashOperations`, DB version 19). Existing pending outgoing token transactions can be lazily projected into lifecycle records when status is queried.
- Token creation records `delivery='not_required'`; direct npub/nprofile delivery records `pending_publish` then `published` or `publish_failed`.
- Stale `pending_publish` records with a created token are converted to `delivery='unknown'` during reconciliation so an interrupted npub send can be checked/claimed/reclaimed instead of being stuck in a non-reclaimable publishing phase.
- App start/resume recovery now also reconciles open outgoing eCash lifecycle records after Cashu initialization.
- When outgoing claim checks detect a claimed token, the service finalizes the Coco send operation best-effort, removes pending-send records, settles the transaction as `claimed`, and emits the existing send/transaction events.
- Reclaim/finalize observer paths now update outgoing lifecycle too, so Coco `send:finalized` and `send:rolled-back` events keep transaction detail and pending lists aligned.
- Related outgoing flows were rechecked end-to-end: plain eCash token creation, direct npub/nprofile route execution and relay publish result, legacy pending outgoing transactions without lifecycle rows, Coco finalized/rolled-back observer events, manual transaction-detail status check, public `PaymentUseCase.completeSend/reclaim`, and reclaim fallback paths now all converge on the same outgoing lifecycle state.
- Token creation and direct npub/nprofile send now persist the Coco send `operationId` before token execution completes. If the app stops after prepare/execute but before token metadata is fully written, startup/status reconciliation can still inspect the Coco operation state and either keep it recoverable, mark it claimed, or mark it reclaimed.
- The Cashu claim-state adapter now uses SDK operation state when only `operationId` is available: `finalized` maps to claimed, `rolled_back` maps to reclaimed, and prepared/pending operations without token metadata remain recoverable instead of becoming an unrecoverable local-only pending row.
- Existing-user update safety was rechecked. The current DB version bump adds new Dexie tables only and does not clear or rewrite `encryptedWallet`, settings, proofs, or transactions. A pre-existing risky fallback was fixed: if initial wallet/settings DB loading fails during update, the app now shows a retryable wallet-load error instead of falling through to onboarding/new-wallet creation.
- Transaction detail now shows lifecycle-derived states such as `수령 대기`, `전송됨 · 수령 대기`, `수령 완료`, `회수 완료`, and `전송 실패` instead of raw generic `처리중` for outgoing eCash. Normal `PENDING` proof transitions no longer show `상태 확인 실패`.
- Verification passed: `npx tsc --noEmit`, focused outgoing/incoming/reclaim/payment/route/transaction-detail tests, `bun run lint`, full `bun run test:run` (103 files / 730 tests), `bun run build`, wallet `hex-review` (587 files / 0 violations), targeted security/hardcoding scan, and `git diff --check`.
- Build still emits the existing Vite dynamic/static import and large chunk warnings; no new failure was introduced.

# Current Task — Robust npub Gift-Wrap Receive Sync

- [x] Document design and risk review before implementation
- [x] Prevent one-off Nostr send/fetch relays from replacing the wallet's receive relay target set
- [x] Make gift-wrap fetch cursor-safe with NIP-17/59 timestamp overlap and `since` support
- [x] Persist incoming gift-wrap events before redeeming so live subscription and catch-up fetch share one inbox
- [x] Route live, resume, and startup gift-wrap receive through one idempotent processor
- [x] Persist untrusted-mint review state so restart/resume cannot drop review-required tokens
- [x] Add stale processing recovery and Coco receive-operation recovery coverage for interrupted token receives
- [x] Rewire startup/resume sync with throttling and duplicate execution guards
- [x] Run focused tests, full tests/build, hex-review, security/hardcoding scans, and `git diff --check`

Design
- Nostr gift-wrap receipt has two discovery paths: live subscription and catch-up fetch. Both must only ingest events into a persistent inbox keyed by `eventId`; neither path should redeem directly.
- The inbox is the processing source of truth with statuses: `pending`, `processing`, `review_pending`, `processed`, `failed`, and `skipped`.
- Processing must use one path for all sources: parse gift-wrap content, verify token/mint, queue untrusted tokens for user review, redeem trusted tokens via `IncomingPaymentService`, settle linked receive requests, emit one receive event, and mark processed.
- Catch-up fetch must use `since = cursor - overlap`, where overlap covers NIP-17/NIP-59 backdated wrapper/seal timestamps. Event duplication from overlap is handled by `eventId` upsert and processed-record checks.
- Relay fetch progress must not be advanced in a way that can skip failed relays. One-off send/fetch relay connections must not replace the gateway's long-lived receive relay target list.
- If the PWA stops while a token is being redeemed, the next startup/resume must reset stale `processing` items and run Coco receive-operation recovery before deciding whether to retry or mark the event processed.
- Untrusted-mint reviews are not complete until the user accepts or rejects them; this state must survive restart and must not be represented only by Zustand runtime state.

Review Checklist
- No UI-to-adapter/module import boundary widening.
- No raw private key, nsec, or relay hardcoding.
- No `hex-ignore`, workaround-only paths, or direct Dexie access from UI.
- No duplicate redeem, duplicate toast, duplicate transaction, or skipped review when live and fetch see the same event.
- No reliance on NIP-17 wrapper `created_at` without at least a two-day overlap.
- No receive relay subscription loss after direct npub send to another user's DM relays.

Review
- Live gift-wrap subscription and startup/resume catch-up now both first persist unwrapped messages into a Dexie-backed inbox keyed by `eventId`. Token parsing/redeem/review/ACK happens only through `GiftWrapInboxService`, so live and fetch paths no longer have separate redeem logic.
- Relay fetch uses per-relay cursors with a two-day-plus overlap for NIP-17/NIP-59 randomized timestamps. `since=0` is handled explicitly instead of being dropped as falsy.
- Nostr one-off send/fetch relays are connected with `ensureRelays()` and no longer replace the gateway's long-lived target relay set. `connect(settings.relays)` remains the only target-set update path, and active subscriptions resubscribe when settings relays change.
- `nostr-crypto.unwrapEvent` now explicitly decrypts gift-wrap → seal → rumor, verifies the seal signature, and rejects a rumor whose `pubkey` does not match the seal author. Tests cover the happy path and mismatch rejection.
- Untrusted mint receipts persist as `review_pending` inbox items with token metadata, then requeue into the existing review flow after restart/resume until the user accepts or rejects. Accept/reject now marks the persisted inbox item processed/skipped as well as the existing processed store.
- Startup/resume catch-up is throttled and guarded against concurrent execution. It waits for Cashu module initialization before starting the watcher or processing catch-up, preventing unlock-time receive races.
- `payment.recoverAll()` now includes Coco receive-operation recovery, so an interrupted `ops.receive` can be reconciled on startup/resume before gift-wrap processing retries.
- Existing recovery `syncAll()` is wired to the same gift-wrap inbox processor in the app composition, avoiding a second direct redeem path.
- Validation passed: `npx tsc --noEmit`, focused gift-wrap/nostr/cashu/recovery/bootstrap tests, `bun run lint`, `bun run test` (100 files / 712 tests), `bun run build`, wallet `hex-review` (580 files / 0 violations), and `git diff --check`.
- Manual scan found no new hardcoded relay/private-key/nsec values, no `hex-ignore`, no unsafe HTML, and no new UI-to-adapter/module/composition imports in the changed runtime paths. The remaining TODO/workaround matches are pre-existing Cashu/bootstrap comments outside this change.

# Current Task — Name Truncation + npub History Labels

- [x] Truncate long wallet/contact names on final confirmation screens without changing protocol data
- [x] Label direct npub transaction history as send/receive via npub
- [x] Rename wallet recovery settings entry to include verification in the product tone
- [x] Review whether contact names can be displayed for incoming address-book transactions without implementing it
- [x] Verify lint/typecheck/tests/build, hex-review, and diff checks before completion

Plan
- Keep truncation as a display concern in UI only; never mutate mint names, contact names, addresses, or transaction metadata for layout.
- Persist npub transport context as neutral transaction metadata at the route/payment boundary, then derive history labels from that metadata in shared history helpers.
- Preserve contact display names separately from raw payment addresses across Send destination, amount, and confirm steps.
- Keep address-book-name history display as a review-only architecture note unless it can be done without widening this patch.

Review
- Long names are now CSS-truncated only at display time, based on the rendered name area rather than a fixed character count. Send amount/confirm, eCash create confirm/result, and eCash register confirm screens do not mutate saved mint/contact names, addresses, memo, or transaction data.
- Send amount/confirm steps now receive the contact display name separately from the raw address, so npub/nprofile address-book sends show the saved contact name instead of a shortened npub.
- Returning from Send amount back to destination now restores both the validated input and raw address for contact selections, preventing the contact display name from being revalidated as an unrecognized address or showing technical badges like `Cashu Request`.
- Send sending/complete steps now receive the same contact display name, so direct npub address-book sends do not fall back to the generic `eCash` recipient label at the end of the flow. Manual direct npub/nprofile sends now fall back to a shortened npub/nprofile target instead of `eCash`. Sending/complete copy also keeps localized particles/prepositions (`에게`, `へ`, `to`, `ke`, `a`) attached to the recipient name while truncating only the name.
- Send/create confirmation copy now groups localized particles/prepositions with the adjacent name token across supported languages, so very narrow screens truncate the name token instead of leaving `to`, `from`, `?`, `에게`, `에서`, `へ`, or similar fragments stranded on separate lines. The name token no longer uses a fixed viewport width; it now flexes to the remaining phrase width.
- Direct npub/nprofile sends now persist counterparty address metadata from the route-execution boundary. Gift-wrap receives now pass source/counterparty metadata through `IncomingPaymentUseCase` into the redeemed transaction.
- Shared history helpers label those transactions as `전송 (npub)` / `수신 (npub)` in Korean and equivalent localized labels elsewhere. Home/Mint Detail rows, History rows, CSV export, and Transaction Detail use the same label source.
- Settings wallet-management entry/modal title now uses `지갑 점검 및 복구`, which covers both current-wallet verification and recovery/import flows without exposing implementation details.
- Address-book-name display for incoming npub transactions is feasible but not implemented here. The current receive metadata stores sender hex pubkey, while contacts are stored as npub/nprofile strings and the contact repository matches exact address strings. A proper follow-up should normalize/store `pubkeyHex` for npub/nprofile contacts or add a `findByNostrPubkey` use-case, then build a contact-name map once in the UI/history hook instead of querying per row.
- Verification passed: `npx tsc --noEmit`, focused Vitest files including send display-name regressions, `bun run lint`, `bun run test` (99 files / 707 tests), `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src` (575 files / 0 violations), and `git diff --check`.
- Manual rule scan found no new secrets, hardcoded private keys, `hex-ignore`, unsafe HTML, or UI-to-adapter/module/composition imports in touched runtime files. The only touched-file TODO match is an existing `PaymentService.findModuleForAccount` TODO unrelated to this patch.

# Current Task — Wallet Recovery + npub Send + Name Limits

- [x] Re-read root/wallet rules and current lessons before implementation
- [x] Change address-book name limit to 30 and mint custom name limit to 20 via shared constants
- [x] Remove onboarding wallet import/recovery so a fresh install only creates a new wallet
- [x] Split settings wallet recovery into current-wallet recovery and external-mnemonic ecash import
- [x] Implement external-mnemonic recovery without mutating the current Coco seed/cache
- [x] Enable address-book npub send and manual npub/nprofile send input
- [x] Enforce npub send policy: common mint required, recipient DM relay required, P2PK applied when advertised
- [x] Run lint, typecheck, tests, build, hex-review, hardcoding/security scans, and `git diff --check`

Plan
- Keep UI outside the hexagon by using `ServiceRegistry` driving ports. Do not import Coco internals from UI.
- Recovering another mnemonic must restore proofs with an isolated cashu-ts wallet, encode recovered unspent proofs as Cashu tokens, and redeem those tokens through the current wallet. Never swap the global Coco seed getter or current encrypted wallet mnemonic.
- Direct npub/nprofile sending is modeled as a same-mint-only NUT-18/NIP-17 payment target. It reuses the existing route executor and P2PK locking path, but disables cross-mint fallback for this entry point.
- Address-book entry starts with no source mint, so it shows only common mints. Mint-card entry preserves the selected source mint and asks the user before switching if the recipient cannot receive from that mint.

Review
- Address-book names now use `LIMITS.MAX_CONTACT_NAME_LENGTH = 30`; mint custom names use `LIMITS.MAX_MINT_NAME_LENGTH = 20` in mint info editing and the reusable mint card edit path.
- Fresh onboarding no longer offers mnemonic import/recovery. It only creates a new wallet, fetches ZS config/default settings, and publishes the new wallet profile.
- Settings wallet recovery now starts with a choice: recover missing ecash for the current wallet, or scan another mnemonic and import recovered ecash into the current wallet.
- External mnemonic recovery uses an isolated `cashu-ts` wallet with `batchRestore` per registered mint/keyset, filters unspent proofs, encodes them as Cashu tokens, and redeems through the current `PaymentUseCase`. It does not swap or mutate the current Coco seed/cache.
- Address-book npub/nprofile send and manual send input are enabled. Sending requires recipient `10019` mint info, a common mint, and recipient `10050` DM relay info. `nprofile` relay hints and local default relays are not used for actual sending.
- P2PK is applied only when the recipient advertises it in `10019`; otherwise the same-mint NUT-18 delivery path remains unlocked because current wallet P2PK locking is optional for this scope.
- Same-mint-only direct npub sends cannot fall back to Lightning/cross-mint routes. If the selected mint is unsupported but another common mint exists, the user must explicitly select one of the common mints.
- Verification passed: `npx tsc --noEmit`, `bun run lint`, `bun run test` (93 files / 687 tests), `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src` (551 files, 0 violations), and `git diff --check`.
- Manual security/hardcoding scan found no new private keys, nsec values, production relay constants, `hex-ignore`, TODO/FIXME workaround markers, or UI-to-adapter/module/composition boundary violations in the new implementation. Sensitive-looking matches were test fixtures only.
- Root `verify-implementation` still references a missing `verify-ecash` skill, and wallet-local `verify-*` skills are absent, so that authored verify pipeline remains non-executable in the current workspace.

# Previous Task — Customer Support Inbox Unread UX

- [x] Re-check root and wallet rules before changing support UX
- [x] Add protocol-neutral local archive support for customer-side inquiry deletion
- [x] Add global support unread summary state and reply toast watcher
- [x] Propagate unread badges from root settings navigation to profile, support history, and ticket cards
- [x] Preserve agent-side resolved/closed status after restart when the original ticket event replays
- [x] Rework support history cards to remove card status/chevron, show compact date next to title, show terminal copy in preview, and keep unread reply count
- [x] Add a vertical action menu for pin/unpin, mark read, and local leave/archive actions
- [x] Polish support card details: pinned icon next to the date, centered larger action button, outside-click menu dismissal, unread badge overlay, and support UI radius aligned to `rounded-card`
- [x] Polish support conversation details: support-agent messages show the Zappi logo and `Zappi team`, and the support page no longer reserves excessive bottom padding
- [x] Persist pin/read/archive state in the support history store without sending unsupported customer-side resolve/close events
- [x] Run focused support tests, typecheck, lint, hex-review, full tests/build, security/hardcoding scans, and `git diff --check`

Review
- Customer-side deletion is implemented as local archive/hide only. It does not send a forged customer-side resolve/close event to the support agent.
- Agent-side resolved/closed status is persisted in Dexie and no longer downgrades to `open` if the original ticket event is replayed after restart.
- Unread counts are calculated from support-agent messages newer than each ticket's `readAt`; customer messages do not count as unread.
- The global support watcher suppresses toasts during initial cache/relay hydration, then shows a toast only for newly observed support-agent replies.
- Opening a ticket still marks it read through the support use case, clearing the global badge path.
- Support history cards no longer display a status badge or right chevron. The title row shows the compact date (`M.D`), resolved/closed tickets show terminal copy in the preview line, and the card action menu exposes pin/unpin, read, and leave.
- Pinned tickets show a pin icon next to the compact date. The three-dot action button is vertically centered and larger, the menu closes on outside click or Escape, and unread counts are rendered as an overlay badge instead of reserving separate card space.
- Support-agent conversation bubbles now render like a messenger thread with the Zappi logo avatar and `Zappi team` label; customer messages remain right-aligned.
- The support page bottom padding was reduced from `pb-28` to `pb-6` because this full-screen settings overlay does not need to reserve bottom-tab space.
- Support page cards, forms, inputs, menus, attachment controls, and message bubbles now use the same `rounded-card` radius as the app's registration buttons; numeric unread badges keep the existing rounded badge shape.
- Pinning, marking read, and leaving are implemented through protocol-neutral support use case methods backed by the support adapter/history store. No UI code mutates Dexie directly.
- Verification passed: focused support tests (4 files / 16 tests), support notification hook tests (3 tests), `npx tsc --noEmit`, `bun run lint`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, `bun run test -- --run` (89 files / 649 tests), `bun run build`, and `git diff --check`. Build still emits the existing Vite dynamic-import/chunk-size warnings.
- Manual audit found no new hardcoded support agent/relay/secret values, no unsafe HTML rendering, no hack/workaround markers in touched support paths, and no core/adapter hex-boundary violation in touched paths. The remaining sensitive-word matches are existing support privacy copy warning users not to enter private keys/recovery words.
- Skill discovery confirmed wallet-local `hex-review` exists and root `verify-implementation` exists under `../.claude/skills`; wallet-local `verify-*` skills still do not exist.

# Previous Task — Customer Support UX, Sync, and Attachments

- [x] Remove customer-facing technical relay wording from support loading/sending states
- [x] Treat resolved/closed support tickets as terminal in the core support flow, not only in the UI
- [x] Show a terminal conversation notice after a ticket is resolved or closed and disable follow-up sends
- [x] Add real support file attachment send/download support with encryption, hash verification, and configured Blossom storage
- [x] Make support synchronization explicit on connect, focus/online resume, and manual refresh-capable use case seams
- [x] Update focused tests for terminal-ticket behavior, attachment metadata/download, config validation, and sync refresh
- [x] Re-run hex-review, lint, typecheck, focused tests, full tests/build, and `git diff --check`

Review
- Support loading state no longer renders the "relay" connection notice in the customer UI. Submit copy now says `문의 등록 중입니다.` and reply copy says `메시지를 보내는 중입니다.`.
- Follow-up QA fixed the submit loading state to render a spinner next to `문의 등록 중입니다.`.
- Follow-up QA fixed restart inbox hydration: the support adapter now derives the customer support pubkey and restores Dexie-cached tickets/messages before waiting for the SDK network connection, so the local 문의 내역 appears immediately and relay sync updates it afterward.
- Resolved/closed tickets are now terminal at both layers: `SupportService` blocks customer follow-up before calling the channel, and `NostrCsCustomerSupportAdapter` also refuses to send if the current ticket status is resolved or closed. The conversation UI replaces the input with `문의가 해결되었습니다.` or `문의가 종료되었습니다.`.
- Attachment support is now actual file transfer, not metadata-only UI. The wallet converts selected files to protocol-neutral attachment inputs, encrypts them with AES-GCM, uploads ciphertext to configured Blossom storage, sends the validated `nostr-cs` envelope attachment, downloads ciphertext by Blossom hint, decrypts it, and verifies both ciphertext/plaintext hashes before saving.
- Blossom storage is configured via `VITE_ZAPPI_SUPPORT_BLOSSOM_SERVERS`; no code fallback server was added. Local QA `.env.local` was updated with `https://blossom.primal.net`.
- Support sync is explicit on initial connect and on online/visible resume. The refresh seam reconnects the SDK so relay subscriptions can backfill history/status while Dexie remains only a local display cache.
- Verification passed: focused support tests, `npx tsc --noEmit`, `bun run lint`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, `bun run test -- --run` (88 files / 645 tests after follow-up), `bun run build`, and `git diff --check`. Build still emits the existing Vite dynamic-import/chunk-size warnings.

# Previous Task — Customer Support via nostr-cs

- [x] Re-read root `CLAUDE.md`, root `AGENTS.md`, wallet `AGENTS.md`, and `tasks/lessons.md`
- [x] Create a fresh dedicated branch from latest `origin/staging`
- [x] Confirm stale pre-release CS implementation is only in stash and will not be applied
- [x] Design the CS integration around `nostr-cs@0.0.4`, a dedicated derived customer-support key, and env-provided support agent config
- [x] Validate the design with specialist agents before implementation
- [x] Add protocol-neutral core support use case and isolate `nostr-cs` in an adapter/composition layer
- [x] Add a settings/support UI entry and customer ticket/message flow
- [x] Add focused tests for key isolation, config validation, and support use-case behavior
- [x] Run `hex-review`, verify skill discovery, manual architecture/security scans, lint, typecheck, tests, build, and `git diff --check`
- [x] Document final review results here before treating the work as complete

Review
- Active branch is `feat/customer-support-nostr-cs-sdk-0.0.4`, created from latest `origin/staging`.
- The old pre-release CS attempt remains only in `stash@{0}` and must not be applied; implementation started from current code and the released `nostr-cs@0.0.4`.
- Support agent/relay config is deploy-time public config, not source-code constants. The support agent is configured as `VITE_ZAPPI_SUPPORT_AGENT_NPUB` and must be `npub`; raw 64-hex input is rejected to avoid accidentally publishing private-key-shaped values in a public `VITE_` variable.
- The SDK-side hardcoded discovery concern was fixed upstream in `nostr-cs@0.0.4`; wallet integration injects an explicit configured NIP-66 relay index so SDK default monitor relays are not used. The SDK pool is not shared because the current dependency tree has separate `nostr-tools` instances, and importing nested package internals would be a brittle workaround.
- Core support types/ports/services are protocol-neutral. `nostr-cs` imports are isolated under `src/adapters/customer-support`, with composition as the only boundary-crossing wiring layer.
- Settings now exposes Profile → Customer Support. The first scope supports connect, pull own history, create ticket, list tickets/messages, and send follow-up messages. Ticket metadata is kept in memory for this first scope; no support private key/seed is stored in Zustand, Dexie, localStorage, settings, or env.
- The CS identity is derived from the unlocked wallet seed using a dedicated support-only path and kept in adapter memory only. Logout now calls the support use case `destroy()` path, which disconnects and zeroizes the long-lived support private key; derivation `HDKey` private material and per-call NIP-44 conversation keys are also wiped after use.
- Inbound support events are not trusted just because the SDK emitted them. Tickets must match the local CS pubkey and configured support agent pubkey; replies, DMs, and status updates must come from the configured support agent or local customer identity and must match a known ticket thread before UI state is mutated.
- Final specialist audit reported no blockers and no non-blocking findings after the security fixes. `hex-review` passed with 0 violations; manual scans found no nested `node_modules` imports, no support-specific storage of secrets, no unsafe HTML rendering, no hardcoded support agent/relay values, and no hex-boundary violations.
- Verification passed: focused support tests, focused Send input regression tests, `bun run lint`, `npx tsc --noEmit`, `bun run test -- --run` (87 files / 636 tests), `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src`, and `git diff --check`.
- Manual QA found a dev-time support connection race: if `disconnect()` runs while `connect()` is still awaiting the SDK, `this.client` can become `null` before listener attachment. `NostrCsCustomerSupportAdapter` now uses a connection generation guard and local client/pool references, and a regression test covers the disconnect-wins-connect race.
- Manual QA also found the initial support UI too form-like and exposed low-value category/priority choices. The page was simplified to a customer-support inbox pattern: title/body only, privacy reminder, card-based request list, selected conversation thread, clearer status pills, and relay-send progress copy.
- Replies from the `nostr-cs` example agent arrived as raw envelope JSON (`{"v":1,"text":...}`). The adapter now sends with `encodeEnvelope()` and displays incoming ticket/reply/DM bodies through `decodeEnvelope()`, while retaining plain-text fallback compatibility.
- Follow-up UX review restored SDK-required category/priority selection in the compose step, but moved it out of the entry screen. The support page is now "Support history" first: token-paste-style top-right "contact us" action → card-style request list with Zappi logo/date/title/status/unread reply badge → dedicated compose/conversation screens, so the first screen no longer mixes a form with existing requests.
- Support history is now cached in Dexie under a customer-support-specific history store scoped by the derived CS pubkey and configured support agent. Relays remain the protocol source of truth, but restart/offline UX can show the local inbox cache first and then refresh from `pullOwnHistory()`. The cache also stores read state for unread support-reply badges.
- `nostr-cs` envelope attachments are not treated as fully implemented file transfer yet. The wallet now preserves and displays validated attachment metadata from `decodeEnvelope()`, but actual upload/download/decrypt/sha256 verification remains a separate Blossom-backed implementation step.
- Verify-skill discovery: `zappi-wallet/.claude/skills` has no `verify-*` skill. The root `../.claude/skills/verify-implementation/SKILL.md` exists but still references missing `verify-ecash`, matching the existing `.pipeline/verify-implementation-report.md`; therefore the authored verify pipeline cannot be executed until that missing skill is restored or removed.
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
- Date boundaries are computed from local calendar day starts (`new Date(Y, M, D)` and `new Date(Y, M, D - 1)`), not fixed 24h subtraction, so yesterday still starts correctly across DST transitions.
- History keeps virtualization for long lists, but now positions virtualized date groups with `top` instead of `transform` and matches the Token tab group wrapper, so sticky date anchors start at the same row boundary.
- History date groups include measured bottom spacing between groups so a newly changing date is visually separated from the previous day's last row while keeping virtualization accurate.
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

# Current Task — External Mnemonic Recovery Discovery

- [x] Add a hex-safe design for restoring another mnemonic's eCash without changing the current wallet seed
- [x] Discover candidate mints from the external mnemonic's public `kind:10019` profile and encrypted `kind:30078 d=mint-list` backup
- [x] Keep Cashu scanning isolated in the existing Cashu recovery adapter and keep Nostr discovery isolated in a Nostr adapter
- [x] Scan the union of current wallet mints and discovered mints, then redeem only into the current wallet
- [x] Return recovered mint URLs from the use case so the UI can persist only successful new mints
- [x] Verify no UI imports adapters/modules and no core service imports external SDKs

Design notes
- The current wallet seed must never be replaced during this flow. The external mnemonic is only used as a recovery source to derive old deterministic Cashu proofs and old mint-list discovery keys.
- `kind:10019` is a public receiving profile. It can suggest active public mints, but it is not a complete wallet backup.
- `kind:30078` with `d=mint-list` is the encrypted mint-list backup used by Cashu.me/Macadamia style wallets. It is queried through a driven Nostr port and decrypted in an adapter.
- Discovered mints are candidates only. A mint is added to the visible wallet settings only after the recovery scan finds spendable proofs and the current wallet successfully redeems them.
- The UI may orchestrate settings persistence, but it must only call driving ports and app settings callbacks. It must not parse Nostr events, decrypt backups, or call Cashu SDKs.

Review
- Added `ExternalMnemonicMintDiscoveryPort` and a Nostr adapter that derives Cashu.me/Macadamia-compatible mint-backup keys from the external mnemonic, queries public receiving mints and encrypted mint-list backups, and returns normalized candidate mint URLs.
- `ExternalWalletRecoveryService.recoverFromMnemonic()` now scans the union of current configured mints and discovered candidate mints, then returns only successfully redeemed mint URLs. It does not change the active wallet seed.
- `SettingsScreen` calls the external-wallet recovery use case; recovered new mint URLs are persisted through the settings/trust port only after successful redemption, so a discovered-but-empty mint is not added to the visible wallet.
- Cashu restore scanning remains isolated in `modules/cashu/internal/external-mnemonic-recovery.ts`; Nostr discovery/decryption remains isolated in `adapters/nostr/external-mnemonic-mint-discovery.adapter.ts`; UI does not import adapters/modules/composition.
- Build was initially blocked by a pre-existing strict build type issue in `gift-wrap-token`; it was fixed with an explicit direct-token rumor type guard.
- Verification passed: `bun run lint`, `npx tsc --noEmit`, `bun run test` (95 files / 695 tests), `bun run build`, `git diff --check`, and manual touched-file hex-boundary import scans.

# Current Task — Send/Recovery Architecture Hardening

- [x] Move npub/nprofile direct-payment validation out of UI helpers and into a core driving use case
- [x] Replace legacy composition route execution with a core service that depends on driven ports
- [x] Move external mnemonic recovery orchestration out of `PaymentService`
- [x] Let the recovery use case persist only successfully recovered mints through a trust/settings port
- [x] Verify each step with focused tests before moving to the next step
- [x] Run final lint, typecheck, test, build, diff, and hex-boundary checks

Design notes
- `npub` send validation should be reusable by manual send, contacts, and future chat payments. UI should only call `ServiceRegistry.nostrDirectPayment`.
- Route execution should no longer be a composition helper that directly reaches into Cashu primitives, Dexie, HTTP transport, and cross-tab sync. Core should own orchestration; adapters/modules should own SDK/network/storage details behind ports.
- External mnemonic recovery should be a wallet-recovery use case, not a payment-service responsibility. The current wallet seed must remain unchanged.

Review
- `NostrDirectPaymentService` now owns npub/nprofile direct-payment resolution behind `ServiceRegistry.nostrDirectPayment`. Manual send and address-book send both call the same driving use case; the old UI helper was removed.
- `RouteExecutionService` now owns route execution orchestration in core. Cashu operations, pending-route storage, token delivery, and cross-tab sync are injected through driven ports/adapters instead of being reached from a composition helper.
- External mnemonic recovery orchestration was removed from `PaymentService` and moved to `ExternalWalletRecoveryService`. Recovered tokens are redeemed through the current wallet via a `RecoveredTokenReceiver` port, not by mutating the active wallet seed.
- Successfully recovered mint URLs are persisted through `TrustedAccountStore` backed by settings; discovered-only or failed mints are not added.
- Build initially caught a strict backend/port mismatch for melt execution. The port was corrected to use the prepared melt amount and not require a nonexistent backend `amount` field.
- Verification passed: focused tests for direct npub send/route execution/external recovery/bootstrap, `bun run lint`, `npx tsc --noEmit`, `bun run test` (97 files / 694 tests), `bun run build`, `node .claude/skills/hex-review/scripts/check-hex-violations.mjs src` (571 files, 0 violations), `git diff --check`, and manual boundary/security/hardcoding scans.

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
