# Lessons

## 2026-04-22

- Wallet work must never start on `staging` directly. Create a dedicated branch from `staging` before implementation or verification changes.
- Wallet alpha fixes are not done until `bun run lint`, `bun run build`, `bun run test`, rule audit, and `verify-*` status have all been checked and documented.
- Coco version checks must distinguish the legacy `coco-cashu-*` line from the newer `@cashu/*` line before calling one of them the "latest" version.

## 2026-04-23

- Before moving to the next wallet issue after a focused fix, complete a full rule audit against `CLAUDE.md`, root `AGENTS.md`, wallet `AGENTS.md`, and `tasks/lessons.md`; do not assume a focused review is enough.
