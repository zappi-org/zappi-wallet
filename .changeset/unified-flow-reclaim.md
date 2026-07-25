---
"zappi-wallet": patch
---

fix(reclaim): a reclaim is recorded as a reclaim, not a receive or a claim

Reclaiming an ecash token now cancels the send operation instead of self-redeeming it, so the ledger no longer books it as a plain receive; a rolled-back active send is read as a reclaim rather than a failure; a stale settlement event can no longer relabel a claimed send; and a send whose delivery never landed rolls back instead of stranding an unclaimed token.
