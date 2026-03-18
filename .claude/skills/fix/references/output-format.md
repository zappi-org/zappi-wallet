# Fix Report Format

Write to `.pipeline/fix-report.md`.

```markdown
---
date: YYYY-MM-DD
branch: <current branch>
commit: <commit-hash or "not committed">
status: fixed | partial | failed
---

# Fix Report

## Failures Addressed

### <test name> — `file_path`
- Cause: <what was wrong>
- Fix: <what was changed>
- File: `file_path:line`

## Re-run Results

```
<vitest + tsc output summary>
```

- Previously failing: <count>
- Now passing: <count>
- Still failing: <count>

## Remaining Failures

<list any tests still failing after fix attempt>
<If none: "None — all tests passing.">

## Commit

```
<commit message, or "Not committed — failures remain.">
```
```
