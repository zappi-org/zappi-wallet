---
name: review
description: Review plan and code implementation. Checks plan quality against analysis, then reviews code diff for correctness, style, and risks. Use when user says "/review", "리뷰해", or as part of "/go" pipeline. Outputs to .pipeline/review-report.md.
---

# Review

Two-phase review: plan review + code review.

## Input

- `.pipeline/analysis.md` — root cause and affected files
- `.pipeline/plan.md` — implementation plan
- `.pipeline/implement-report.md` — what was actually changed
- `git diff` — actual code changes

## Workflow

### Phase 1: Plan Review
Check `.pipeline/plan.md` against `.pipeline/analysis.md`:
- Does the plan address the root cause?
- Are all affected files covered?
- Is the approach the simplest solution?
- Are there unnecessary changes (scope creep)?
- Does the test plan cover the fix adequately?

### Phase 2: Code Review
Detect base branch dynamically: run `git log --oneline --merges -1` or check `.pipeline/input.md` context. Then run `git diff <base-branch>...HEAD` and review:
- **Correctness**: Does the code actually fix the root cause?
- **Style**: Does it match existing project patterns?
- **Side effects**: Could this change break anything else?
- **Tests**: Do tests verify the right behavior?
- **Omissions**: Is anything missing that should have been changed?

### Phase 3: Verdict
Rate: `approve`, `request-changes`, or `block`.
- `approve` — good to go
- `request-changes` — minor issues, list them
- `block` — fundamental problem, explain why

## Output

Write to `.pipeline/review-report.md`. Follow format in [references/output-format.md](references/output-format.md).
Show verdict + key findings to user.

## Rules

- Be specific. "코드가 좀 이상하다" is not a review. File:line + what's wrong + what to do.
- Don't nitpick style if it matches existing code.
- If plan deviates from analysis, flag it but check if the deviation is an improvement.
- Read implement-report.md Deviations section — deviations need extra scrutiny.
