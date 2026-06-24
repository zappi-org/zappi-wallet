---
"zappi-wallet": patch
---

Incoming payments no longer show duplicate toasts. All incoming paths now produce a single toast via transfer:settled with the appropriate per-protocol message (ecash: "Ecash token received", bolt11: "Lightning payment arrived"). Recovery sync and real-time watcher now share a dedup store to avoid overlap.
