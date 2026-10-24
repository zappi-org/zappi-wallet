---
"zappi-wallet": patch
---

fix(swap): stop a cross-mint swap from hanging the funding sheet, and keep the receive leg recoverable when the target mint rejects the issuance

- `onReceiveCompleted` gains an `onFailed` callback, fed by the SDK's terminal mint-op failure, so the service no longer waits out its five-minute arrival timeout for something that already failed.
- The send leg follows the melt state instead of the call: `settled` when it finalized, still `pending` while in flight, `failed` when coco reclaimed the proofs.
- When the target mint's quote is still `PAID`/`ISSUED`, the receive leg stays `pending` with its `quoteId` in metadata so the recovery sweep can mint it later; the sheet says the balance is still arriving instead of that it failed. An unanswered probe is treated as unknown, not as a loss.
