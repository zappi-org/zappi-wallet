---
name: ship
description: "Squash-merge branch into staging and optionally create a PR. Compiles pipeline artifacts into a clean single commit. Use when user says \"/ship\" after completing /go and manual QA."
---

# Ship

Squash-merge the current branch into staging as a single clean commit.

## Precondition

These files should exist in `.pipeline/`:
- `analysis.md` — root cause / impact analysis
- `plan.md` — implementation plan
- `implement-report.md` — what was changed
- `test-report.md` — test results
- `review-report.md` — review verdict
- `qa-checklist.md` — manual QA checklist

If any are missing, warn but proceed with what's available.

## Workflow

### Step 1: Gather Context
Read all `.pipeline/*.md` files.
Run `git log staging..HEAD --oneline` to get commit list from the branch.

### Step 2: Squash Merge to Staging
```
git checkout staging
git merge --squash <branch>
git commit -m "<type>: <plan title>"
```

This collapses all branch commits into a single commit on staging.
Commit message format: `<fix|feat>: <plan.md title>` with details from analysis + plan.

### Step 3: Push
Push staging to remote.

### Step 4: Cleanup (optional)
Ask user if they want to delete the feature branch (local + remote).

### Step 5: Create PR (if targeting main)
If the user wants a PR to main instead of direct staging merge:
- Use `gh pr create` from staging to main
- **Title**: from plan.md title, prefixed with type (fix/feat)
- **Body**: compiled from pipeline artifacts

### PR Body Format

```markdown
## Summary
<from analysis.md Summary section>

## Root Cause
<from analysis.md Root Cause section>

## Changes
<from implement-report.md Changes section>

## Test Results
<pass/fail summary from test-report.md>

## Review
<verdict from review-report.md>

## QA Checklist
<from qa-checklist.md — copy as-is so reviewer can check items>

---
Generated with pipeline: /start → /go → /ship
```

### Step 6: Report
Show the user: staging commit hash, files changed, PR URL (if created).

## Rules

- **상위 브랜치 머지는 항상 유저 의사결정.** 자동으로 머지/push 하지 않는다. 머지 대상 브랜치, 타이밍, 방법을 유저에게 확인받는다.
- Always squash merge. Never fast-forward or regular merge to staging.
- One commit per feature/fix on staging. Branch history stays on the branch.
- Do NOT push to main directly. Use PR for main.
- Include the QA checklist in the PR body so it can be checked off during review.
- If review verdict was `request-changes` or `block`, include a warning.
