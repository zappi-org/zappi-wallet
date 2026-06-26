---
"zappi-wallet": patch
---

fix(send): back-navigation loses contact context for Nostr contacts

- Restore rawAddressRef from validatedData on remount to prevent
  "Unrecognized address" error after going back from amount step
- Derive detectedTypes from validatedData.request for Nostr npub/nprofile
  to show "Nostr DM" badge instead of "Cashu Request"
- Fix contact name lookup on amount step: use validatedData.request
  (npub) instead of destination (display name) for cashu-request type
