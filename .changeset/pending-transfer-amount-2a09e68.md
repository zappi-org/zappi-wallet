---
"zappi-wallet": patch
---

fix: persist PendingTransfer.amount in IndexedDB

- Add amount column to Dexie PendingTransfer schema
- Save/restore/update amount in DexiePendingTransferStore
- Bump IndexedDB version to 19
