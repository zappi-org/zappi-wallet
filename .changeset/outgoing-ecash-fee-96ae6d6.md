---
"zappi-wallet": patch
---

fix: record outgoing ecash/P2PK send fee and display in transaction detail

- Store prepared send fee in CashuEcashAdapter transportRef
- Persist send fee into Transaction.fee in TransferTxBridge
- Add "Ecash Send: Fee Info" section to TransactionDetailScreen
