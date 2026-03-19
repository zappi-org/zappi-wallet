# Implement Report Format

Write to `.pipeline/implement-report.md`.

```markdown
---
based_on: .pipeline/plan.md
date: YYYY-MM-DD
branch: <branch-name>
commit: <commit-hash>
status: success | partial | blocked
---

# Implement Report: <title>

## Branch

`<branch-name>` — created from `<base-branch>` at `<base-commit>`

## Changes

### `file_path`
<one-line: what was changed>

### `file_path`
<one-line: what was changed>

## Deviations from Plan

<List any differences from plan.md pseudocode and why.>
<If none: "None — implemented as planned.">

## Proposals

<If scope expansion or breaking changes were encountered, describe them here.>
<If none: "None.">

## Test Results

```
<paste vitest/tsc output summary>
```

- Tests added: <count>
- Tests passed: <count>
- Type check: pass | fail

## Commit

```
<full commit message>
```
```

## Notes

- Deviations section is critical — /go orchestrator shows this to the user
- Proposals section triggers a decision point if non-empty
- Keep Changes section to one line per file, details are in the diff
