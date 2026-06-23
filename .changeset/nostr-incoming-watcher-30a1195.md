---
"zappi-wallet": minor
---

feat: replace GiftWrapWatcher with TLS-based NostrIncomingWatcher

- Move trust check, review queue, 5-format parsing into NostrIncomingWatcher
- Add ProcessedStore deduplication to prevent duplicate processing
- Handle POS delivery ACK in GiftWrapSettlementBridge on settled transfers
- Remove obsolete GiftWrapWatcher and its test
