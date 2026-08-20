# zappi-wallet

## 0.4.4

### Patch Changes

- c1d336b: feat(recentCard): add blind toggle to hide recent transaction row
- 93c17f2: fix: improve GrapheneOS QR scanning, support PRF passkey providers, fix Android sheet gestures; perf: smooth receipt rendering
- 0da6ec7: feat(shell): full-bleed standalone UI — black-translucent status bar, safe-area-aware overlays/sheets/nav dock, unified sheet radius, home-gesture guard for the history drawer

## 0.4.3

### Patch Changes

- refactor: reanimate bottom sheet

## 0.4.2

### Patch Changes

- 4d639ed: fix: self-host Pretendard font to bypass CSP style-src restriction

## 0.4.0

### Minor Changes

- 34074e5: Refactored NutZap send-route resolution into a pure domain function, decoupling the fallback decision logic from the SendInputStep hook.
- 6bf71e7: refactor: bottom-sheet QR scanner modal with paste/upload buttons
- 47de82b: feat: swipe-up history bottom sheet with drag-to-dismiss plus home card refresh
- 6bf71e7: QR surfaces now size themselves from their container instead of a fixed 65vw, with the spec quiet zone owned once by the component — a dense code fills ~77% of a phone's width rather than ~51%. Archive QRs gained protocol tabs, the animated frame counter is gone, and a request QR picks up a late-arriving lightning invoice without reopening.
- 6bf71e7: Polish the unified send/receive surfaces: transaction rows now name the act (받음/보냄/되찾음) with the means as subtitle, amount entry leads with the number instead of the prompt, receipt titles distinguish pending from settled, and the request summary, keypad spacing and mint selector share one rhythm across both flows.

### Patch Changes

- 47de82b: ci: add `bun run build` step to catch TypeScript regressions in PRs
- 38bc2eb: refactor: extract shared send route decision logic and error i18n mapping
- 2c8c916: fix(ui): add nostr-direct to SendFlow sendable types
- c91cc2b: refactor(input): resolve email addresses via NIP-05/NutZap with LNURL fallback
- 3ea02e3: ix(input): centralize email NutZap resolution in InputParser.validateAsync
- 06eec83: fix(input): eliminate duplicate LNURL call for email NutZap resolution
- 0b5e907: refactor(input): add nostr-direct type to InputParser, unify NIP-19 classification
- 207a4fa: refactor(nostr): classify recipient pubkey once via discriminated type, drop local relay fallback
- 831a31e: Redesign history timeline and home card, switch primary font to Pretendard, add swap/local-transfer direction labels
- 6bf71e7: fix(feedback): every copy and share confirms itself

  Copy and share actions now share one hook that changes the pressed button and raises a toast, so they no longer rely on haptics that iOS never fires; sharing reports whether it shared, copied or was cancelled instead of guessing.

- 6bf71e7: perf: keep the wallet SDK, charts and oversized art off the boot path

  The eager critical path drops from ~420 KB to ~234 KB gzip by chunking React and the crypto/storage vendors away from the lazy SDK, and image weight drops from 4.6 MB to 1.1 MB by shipping the logo and card art at display size in webp.

- 6bf71e7: fix(reclaim): a reclaim is recorded as a reclaim, not a receive or a claim

  Reclaiming an ecash token now cancels the send operation instead of self-redeeming it, so the ledger no longer books it as a plain receive; a rolled-back active send is read as a reclaim rather than a failure; a stale settlement event can no longer relabel a claimed send; and a send whose delivery never landed rolls back instead of stranding an unclaimed token.

- 6bf71e7: fix(security): validate what other parties hand us

  The invoice an LNURL service returns is now checked against the amount that was requested; gift-wrapped messages must carry a verifiable sender; support attachments are narrowed to an allowlisted MIME before any blob is built and are downloaded rather than opened; and the app ships a Content-Security-Policy.

- 033289f: fix(nostr): use resolved pubkey as transport target in NostrDirectPaymentService

## 0.3.0

### Minor Changes

- 6160904: refactor: bottom-sheet QR scanner modal with paste/upload buttons
- 627fef6: Add balance hide toggle on the home screen, a profile bottom sheet in the top-left corner, and split the wallet recovery menu into distinct flows.
- 627fef6: Auto-restore seed when adding a mint and validate new mints through a fresh network probe instead of the registered-only cache.
- 627fef6: Strengthen key derivation (PBKDF2 600k iterations with automatic re-encryption migration on unlock), add inactivity auto-lock, and perform a complete account-data wipe on logout.

### Patch Changes

- 627fef6: Improve network synchronization, transfer recovery, diagnostics, and customer-support attachment interoperability.
- 627fef6: Split the bootstrap monolith into focused modules, unify domain error contracts and hex conversion, and remove dead code and unused dependencies (R2 audit compliance).
- 627fef6: Replace remaining hardcoded UI strings with i18n keys and fill locale gaps across Japanese, Spanish, and Indonesian.
- 737be2c: chore:migrate ts6 from 5

## 0.2.0

### Minor Changes

- 17d4a39: feat(send): disable P2PK locking for nostr direct token transfers

  - Remove P2PK locking condition from RouteExecutionService token send flow
  - Nostr direct payments now send plain ecash tokens instead of P2PK-locked tokens

- c9bfe8c: feat: migrate to latest coco SDK and refine wallet UI

  - Migrate cashu module to updated coco SDK internals
  - Redesign bottom TabToolbar: EcashPill, WalletPillIcon, WalletTabPicker, MainTabToolbar
  - Add MintCard balance/activity summary card
  - Improve reclaim service with `markSendClaimed` helper and `finalizeSend` error handling
  - Remove direct `getDecodedToken` usage from Nut18HttpPoller; inject `decodeToken` callback
  - Update NostrPaymentTransport eventId trace compatibility
  - Update vite config, package.json dependencies

- 17d4a39: feat: replace GiftWrapWatcher with TLS-based NostrIncomingWatcher

  - Move trust check, review queue, 5-format parsing into NostrIncomingWatcher
  - Add ProcessedStore deduplication to prevent duplicate processing
  - Handle POS delivery ACK in GiftWrapSettlementBridge on settled transfers
  - Remove obsolete GiftWrapWatcher and its test

- feat(og): add domain-aware Open Graph/Twitter card for bot crawlers

  Serve bot.html with OG/Twitter meta tags and /og-open-beta.png only to crawler User-Agents,
  while keeping the PWA bundle free of the OG image. Support wallet.zappi.space,
  wallet-staging.zappi.space, and wallet-nightly.zappi.space via nginx sub_filter.

- 8305b06: feat: unify all payment flows under TransferLifecycleService

  - bolt11 send/receive and ecash creation/registration now route through TransferLifecycleService
  - single source of truth for transfer state from initiation to settlement
  - TransferTxBridge links every protocol path to TransactionRepository automatically

- 12aaffc: add mint-op:finalized to transfer SDK bridge and suppress Coco SDK logs in production
- 6159475: feat(send): add camera shortcut to home with direct confirm entry.
  Pre-validate scans at app level so bolt11/cashu-request with amount
  skip the destination step. Add inline mint selector to confirm screen,
  paste button to scanner view, and default mint injection.

### Patch Changes

- e7d7a29: fix(send): stop using bolt11 description as recipient display
- 384a569: fix: add missing event receive:settled publish from cashu-ecash.adapter.ts
- e2cdd7f: i18n: rename Ecash tab bottom action button labels to 만들기/받기 (Create/Receive) across all locales (ko/en/ja/id/es)
- dbf0cbf: fix: show address book contact name in send flow for cashu requests
- 6d67cc4: Plumb memo from token parsing to transaction creation in the ecash receive flow.
- 57e51ea: Stop NUT-18 HTTP and bolt11 mint pollers from hitting the mint after expiry (local deadline / SDK `EXPIRED` throw).
- 17d4a39: fix: record incoming ecash redeem fee and display gross amount

  - Capture receiveToken result (amount/fee/mintUrl/memo) in CashuEcashAdapter transportRef
  - Store effective swap fee on incoming ecash Transaction
  - Use gross token amount as transaction amount with fee shown separately

- 549b2d3: Incoming payments no longer show duplicate toasts. All incoming paths now produce a single toast via transfer:settled with the appropriate per-protocol message (ecash: "Ecash token received", bolt11: "Lightning payment arrived"). Recovery sync and real-time watcher now share a dedup store to avoid overlap.
- cbf58a4: fix(send): back-navigation loses contact context for Nostr contacts

  - Restore rawAddressRef from validatedData on remount to prevent
    "Unrecognized address" error after going back from amount step
  - Derive detectedTypes from validatedData.request for Nostr npub/nprofile
    to show "Nostr DM" badge instead of "Cashu Request"
  - Fix contact name lookup on amount step: use validatedData.request
    (npub) instead of destination (display name) for cashu-request type

- 17d4a39: fix: record outgoing ecash/P2PK send fee and display in transaction detail

  - Store prepared send fee in CashuEcashAdapter transportRef
  - Persist send fee into Transaction.fee in TransferTxBridge
  - Add "Ecash Send: Fee Info" section to TransactionDetailScreen

- 17d4a39: fix: persist PendingTransfer.amount in IndexedDB

  - Add amount column to Dexie PendingTransfer schema
  - Save/restore/update amount in DexiePendingTransferStore
  - Bump IndexedDB version to 19

- b82ed51: fix(send): unify effectiveDisplayName derivation across all send steps
- c9bfe8c: fix: refine bottom tab styling after UI migration

  - Adjust EcashPill, MainTabToolbar, WalletPillIcon, WalletTabPicker minor style details
  - Clean up MintCard layout

- ec37084: Fix memo extraction from cashuA/cashuB tokens and UTF-8/base64url decoding in domain parser; persist outgoing memo in transportRef for retry-safe token creation.
- da32b76: replace TLS polling with Coco SDK push events, reducing network calls 6×
- 58385d8: refactor(send): inline getConfirmDisplayInfo into sendDisplayHelpers, remove sendConfirmDisplay.ts
- ec7f59a: fix: show ecash toast on token redeem instead of lightning toast

## 0.1.3

### Patch Changes

- 4214eeb: fix: redeem failure for fee-bearing mints with v2 keyset short IDs

## 0.1.2

### Patch Changes

- 9ffe6ba: feat: distinguish consumed tokens in reclaim flow

  Separate TokenSpentError into technical error and TokenSpentByRecipientError
  (domain semantic). UI now correctly shows 'consumed' instead of 'registered'
  when reclaiming tokens already claimed by recipient.

- 7e0cafa: fix: BaseError propagation across payment/receive/swap flows, improved token parsing, and error toast UX
- ab84ef5: refactor(cashu-backend): reduce @cashu/cashu-ts dependency and remove dead code.

  - migrate getEncodedToken, getDecodedToken to coco-cashu-core
  - remove unused functions (getPendingMeltOperations, checkMeltQuoteStatus)

- 38647b9: refactor(cashu-backend): streamline estimateReceiveFee using prepared op fields
- ee04f03: @cashu/cashu-ts raw calls replaced with Coco SDK APIs, unified under mint operation lifecycle:
- 4b1e6b1: refactor: token reclaim flow with Result<BaseError> pattern and improved UX
  - Migrate reclaim flow to Result<T, E> pattern with BaseError types
  - Add ReclaimService for dedicated reclaim business logic
  - Add TokenSpentError for already-claimed tokens, UnknownError for failures
  - Improve error handling with i18n toast messages (KO/EN/ES/JA/ID)
  - Fix TokenDetailScreen to work within ServiceProvider scope
  - Fix pending-items query to use Repository API with outcome filter
  - Add auto-detection when recipient claims before sender reclaims
  - Close reclaim sheet after confirm regardless of result
  - Add 18 unit tests for ReclaimService

## 0.1.1

### Patch Changes

- 0.1.1 release

  - Restore balance recovery scan that had stopped running on startup.
  - Separate the mnemonic backup confirmation flow from the initial backup screen.
  - Use saved mint card colors consistently across the wallet UI.
  - Align mint color fallback selection so missing colors pick a stable default.
  - Use the tapped mint for home card actions instead of the active mint.
  - Make the wallet button on the eCash token toolbar navigate directly to the wallet tab instead of opening the side picker.
