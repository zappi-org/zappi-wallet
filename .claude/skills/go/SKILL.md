---
name: go
description: "Execute approved plan: implement → review + test + qa in parallel. Use when user says \"/go\" after approving a plan from /start. Orchestrates /implement → /review + /test + /qa → shows results and waits."
---

# Go

Implement the approved plan, then run review, tests, and QA in parallel.

## Precondition

`.pipeline/plan.md` must exist with `status: pending_review` (meaning user approved it via `/start`).
If not found, tell the user to run `/start` first.

## Workflow

### Step 1: Implement
Run `/implement`.
Wait for `.pipeline/implement-report.md`.

Check the report:
- If `status: blocked` → show Proposals to user, stop.
- If `status: success` or `partial` → continue.

### Step 2: Parallel Execution
Run these three in parallel (use Agent tool):
- `/review` — plan + code review
- `/test` — full test suite
- `/qa` — manual QA checklist

Wait for all three to complete.

### Step 3: Handle Test Failures
If `/test` reports failures:
- Run `/fix` once.
- If fix succeeds → continue.
- If fix fails → include remaining failures in the report.

### Step 4: Present
Show the user:
1. Implement report (branch, changes, deviations)
2. Review verdict (approve / request-changes / block)
3. Test results (pass/fail)
4. QA checklist
5. Ask: **수동 QA 후 /ship 또는 수정 요청**

## After User Decision

- **`/ship`** → create PR
- **수정 요청** → user gives feedback, can re-run `/implement` or individual skills
- **반려** → pipeline ends

## Rules

- Never skip `/review`. Even trivial fixes get reviewed.
- If review verdict is `block`, flag it prominently to the user.
- Test failures after `/fix` are reported but do NOT block the pipeline — user decides.
