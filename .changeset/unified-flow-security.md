---
"zappi-wallet": patch
---

fix(security): validate what other parties hand us

The invoice an LNURL service returns is now checked against the amount that was requested; gift-wrapped messages must carry a verifiable sender; support attachments are narrowed to an allowlisted MIME before any blob is built and are downloaded rather than opened; and the app ships a Content-Security-Policy.
