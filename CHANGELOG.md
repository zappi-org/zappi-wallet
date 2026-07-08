# zappi-wallet

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
