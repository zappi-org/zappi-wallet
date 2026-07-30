---
"zappi-wallet": patch
---

perf: keep the wallet SDK, charts and oversized art off the boot path

The eager critical path drops from ~420 KB to ~234 KB gzip by chunking React and the crypto/storage vendors away from the lazy SDK, and image weight drops from 4.6 MB to 1.1 MB by shipping the logo and card art at display size in webp.
