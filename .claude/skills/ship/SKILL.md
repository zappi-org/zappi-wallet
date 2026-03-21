---
name: ship
description: "Squash-merge branch into a target branch and optionally create a PR. Use when user says \"/ship\" or \"/ship <target-branch>\" after completing /go and manual QA."
---

# Ship

Squash-merge the current branch into a user-specified target branch as a single clean commit.

## Arguments

- `<target-branch>` — the branch to squash-merge into. **Required.**
  - If not provided as argument, ask the user before proceeding. Do NOT assume staging or any default.
  - Examples: `/ship nightly`, `/ship staging`, `/ship main`

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
Run `git log <target-branch>..HEAD --oneline` to get commit list from the branch.

### Step 2: Confirm
Show the user:
- Source branch (current)
- Target branch
- Commit list to be squashed
- Ask for confirmation before proceeding.

### Step 3: Squash Merge
```
git checkout <target-branch>
git merge --squash <source-branch>
git commit -m "<type>: <plan title>"
```

This collapses all branch commits into a single commit on the target branch.
Commit message format: `<fix|feat>: <plan.md title>` with details from analysis + plan.

### Step 4: Push
Push the target branch to remote.

### Step 5: Cleanup (optional)
Ask user if they want to delete the feature branch (local + remote).

### Step 6: Create PR (optional)
If the user wants a PR to another branch (e.g., target → main):
- Use `gh pr create` with base set to the PR target
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

### Step 7: Report
Show the user: target branch, commit hash, files changed, PR URL (if created).

## Rules

- **머지 대상은 항상 유저가 지정한다.** 인자 없이 호출 시 반드시 물어본다. 절대 기본값으로 진행하지 않는다.
- Always squash merge. Never fast-forward or regular merge.
- One commit per feature/fix on the target branch. Branch history stays on the source branch.
- Do NOT push to main directly. Use PR for main.
- Include the QA checklist in the PR body so it can be checked off during review.
- If review verdict was `request-changes` or `block`, include a warning.
- `.pipeline/` 파일은 기본적으로 로컬에 보존한다. 유저가 명시적으로 삭제를 요청한 경우에만 삭제.
