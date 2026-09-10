---
"zappi-wallet": patch
---

feat(mostro): add Mostro P2P Lightning-over-Nostr marketplace foundation. Wires `mostro-ts-client` behind a protocol-neutral `MostroMarket` driven port (`MostroUseCase`), with seed-derived identity/trade keys, an encrypted-at-rest IndexedDB store, lifecycle connect/disconnect, logout wipe, a reactive snapshot store bridge, and trade actions (fiat-sent/release, cancel, dispute, rating, restore). Disabled unless `VITE_ZAPPI_MOSTRO_INSTANCE`/`VITE_ZAPPI_MOSTRO_RELAYS` are configured. No UI yet.
