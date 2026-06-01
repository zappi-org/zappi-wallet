---
"zappi-wallet": minor
---

feat: unify all payment flows under TransferLifecycleService

- bolt11 send/receive and ecash creation/registration now route through TransferLifecycleService
- single source of truth for transfer state from initiation to settlement
- TransferTxBridge links every protocol path to TransactionRepository automatically
