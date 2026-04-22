# Lessons

## 2026-04-22

- Wallet work must never start on `staging` directly. Create a dedicated branch from `staging` before implementation or verification changes.
- Wallet alpha fixes are not done until `bun run lint`, `bun run build`, `bun run test`, rule audit, and `verify-*` status have all been checked and documented.
