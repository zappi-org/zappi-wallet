---
"zappi-wallet": patch
---

fix(swap): fail a cross-mint swap when the target mint rejects the issuance, instead of leaving the funding sheet on "Loading…" until the five-minute arrival timeout
