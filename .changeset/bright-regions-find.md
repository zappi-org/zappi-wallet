---
"zappi-wallet": patch
---

feat: distinguish consumed tokens in reclaim flow

Separate TokenSpentError into technical error and TokenSpentByRecipientError
(domain semantic). UI now correctly shows 'consumed' instead of 'registered'
when reclaiming tokens already claimed by recipient.
