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

### Step 2: Parallel Execution (MUST)
**CRITICAL: This step is NOT optional. ALWAYS run all three before presenting results.**

Run these three in parallel using the Agent tool (3 concurrent agents):
- `/review` — plan + code review
- `/test` — full test suite
- `/qa` — manual QA checklist

Wait for all three to complete. Do NOT skip any. Do NOT present results to the user before all three finish.

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

- **상위 브랜치 머지는 항상 유저 의사결정.** `/go`는 하위 브랜치에서만 작업한다. staging/main 머지는 `/ship`에서 유저 확인 후 진행.
- Never skip `/review`. Even trivial fixes get reviewed.
- If review verdict is `block`, flag it prominently to the user.
- Test failures after `/fix` are reported but do NOT block the pipeline — user decides.
