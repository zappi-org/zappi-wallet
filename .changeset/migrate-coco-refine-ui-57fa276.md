---
"zappi-wallet": minor
---

feat: migrate to latest coco SDK and refine wallet UI

- Migrate cashu module to updated coco SDK internals
- Redesign bottom TabToolbar: EcashPill, WalletPillIcon, WalletTabPicker, MainTabToolbar
- Add MintCard balance/activity summary card
- Improve reclaim service with `markSendClaimed` helper and `finalizeSend` error handling
- Remove direct `getDecodedToken` usage from Nut18HttpPoller; inject `decodeToken` callback
- Update NostrPaymentTransport eventId trace compatibility
- Update vite config, package.json dependencies
