---
"zappi-wallet": patch
---

fix(feedback): every copy and share confirms itself

Copy and share actions now share one hook that changes the pressed button and raises a toast, so they no longer rely on haptics that iOS never fires; sharing reports whether it shared, copied or was cancelled instead of guessing.
