# zappi-wallet

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
