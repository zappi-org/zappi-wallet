---
"zappi-wallet": patch
---

fix: record incoming ecash redeem fee and display gross amount

- Capture receiveToken result (amount/fee/mintUrl/memo) in CashuEcashAdapter transportRef
- Store effective swap fee on incoming ecash Transaction
- Use gross token amount as transaction amount with fee shown separately
