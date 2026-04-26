# Lessons

## 2026-04-22

- Wallet work must never start on `staging` directly. Create a dedicated branch from `staging` before implementation or verification changes.
- Wallet alpha fixes are not done until `bun run lint`, `bun run build`, `bun run test`, rule audit, and `verify-*` status have all been checked and documented.
- Coco version checks must distinguish the legacy `coco-cashu-*` line from the newer `@cashu/*` line before calling one of them the "latest" version.

## 2026-04-23

- Before moving to the next wallet issue after a focused fix, complete a full rule audit against `CLAUDE.md`, root `AGENTS.md`, wallet `AGENTS.md`, and `tasks/lessons.md`; do not assume a focused review is enough.

## 2026-04-24

- Final reports must explicitly say whether the rule audit included untracked new files, architecture import boundaries, `verify-*` discovery, and `tasks/lessons.md`; a focused review-agent pass is not enough to imply a full audit.
- Skill discovery must inspect the actual `.claude/skills/` directories before saying a project skill is absent; `rg --files | rg '(^|/)verify-'` is not a substitute for checking registered skill folders and wrapper references.
- Token receive recovery must never persist trusted-mint state as a side effect of “receive to my wallet”; Coco may require operation-scoped trust for receive/redeem APIs, but mints outside user settings must be restored to untrusted state and require an explicit user action before becoming trusted.
- Global domain-event toasts are risky for composed flows: low-level `swap:failed` events can duplicate or contradict contextual UI, so user-facing swap errors should be owned by the initiating flow unless the event carries enough context to route safely.
- Security/state restoration cleanup must not be best-effort `catch`/log when failure can persist privileged or trusted state. Surface the failure and cover it with a regression test.
- Architecture audits include test files and untracked files. Tests that need `modules/*/internal` access should either live inside that internal boundary or test through a public/factory seam.
- Coco receive `prepare` is not safe as a passive UI estimate for Cashu tokens; it can mutate output signing state and later surface `output already signed`. Token scan and cross-mint preflight must not call redeem-fee estimation through receive prepare/cancel.
- Unknown-mint token receive should prefer a simple explicit trust decision over convenience swaps. If a mint is not configured, offer add-and-receive or reject; avoid receive-to-my-mint flows that can redeem before the user understands where funds will land.
- Coco token receive can surface fee shortfalls as raw SDK text such as `Receive amount is not sufficient after fees`; classify this at the Cashu boundary and preserve the domain error code through `PaymentService` so UI never displays raw SDK English.
- Token receive copy must not promise “no fee” for direct/original-mint receive; Cashu mint input fees can still consume tiny tokens. The receive-token UX should keep a simple pre-redeem decision: configured mint tokens offer original-mint receive or reject, and unconfigured mint tokens offer add-and-receive or reject.
- Transaction repository updates must merge metadata rather than replace it when adding derived fields like effective fees; swap route metadata (`fromMintUrl`/`toMintUrl`) is needed by both linked transaction rows.
- Do not expose a payable receive QR before its canonical ReceiveRequest lifecycle record is persisted. Legacy pending quote/UI state must be added only after the domain record exists.
- If a post-redeem lifecycle write can fail, the retry queue must persist enough context to repair that lifecycle write without re-redeeming an already-spent token.
