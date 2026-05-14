---
"zappi-wallet": patch
---

refactor(cashu-backend): reduce @cashu/cashu-ts dependency and remove dead code.

- migrate getEncodedToken, getDecodedToken to coco-cashu-core
- remove unused functions (getPendingMeltOperations, checkMeltQuoteStatus)
