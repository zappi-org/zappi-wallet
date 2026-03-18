---
name: ship
description: "Create a PR from pipeline artifacts. Compiles analysis, plan, review, test results, and QA checklist into a PR description. Use when user says \"/ship\" after completing /go and manual QA."
---

# Ship

Create a pull request from the current pipeline state.

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
Run `git log main..HEAD --oneline` to get commit list.

### Step 2: Push
Push the current branch to remote with `-u` flag.

### Step 3: Create PR
Use `gh pr create` with:
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

### Step 4: Report
Show the PR URL to the user.

## Rules

- Do NOT push to main/master directly. Always create PR.
- Include the QA checklist in the PR body so it can be checked off during review.
- If review verdict was `request-changes` or `block`, include a warning in the PR description.
