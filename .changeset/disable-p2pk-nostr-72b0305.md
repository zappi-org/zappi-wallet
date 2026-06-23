---
"zappi-wallet": minor
---

feat(send): disable P2PK locking for nostr direct token transfers

- Remove P2PK locking condition from RouteExecutionService token send flow
- Nostr direct payments now send plain ecash tokens instead of P2PK-locked tokens
