---
"zappi-wallet": patch
---

feat(ui): add a test-id contract (`src/ui/lib/test-ids.ts`) plus a dev-only `?seed=1` entry point, so agents can drive the UI without walking onboarding or matching translated copy

fix(ui): the install screen is what keeps wallet storage out of Safari's 7-day eviction, so `?seed=1`, `?mode=standalone` and `?bypass=true` now work in dev builds only; `check:seed-leak` fails CI and the Docker build if one reaches `dist/`
