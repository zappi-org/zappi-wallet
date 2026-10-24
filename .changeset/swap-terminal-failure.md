---
"zappi-wallet": patch
---

fix(swap): stop a cross-mint swap from hanging the funding sheet, and keep the receive leg recoverable when the target mint rejects the issuance

- `onReceiveCompleted` gains an `onFailed` callback, fed by the SDK's terminal mint-op failure, so the service no longer waits out its five-minute arrival timeout for something that already failed.
- The send leg is marked `settled` when the melt went through — it used to be overwritten with `failed` even though the funds had left the source mint.
- When the target mint's quote is still `PAID`, the receive leg stays `pending` (with the mint's reason in metadata) so the recovery sweep mints it later; the sheet says the balance is still arriving instead of that it failed.
