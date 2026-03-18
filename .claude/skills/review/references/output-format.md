# Review Report Format

Write to `.pipeline/review-report.md`.

```markdown
---
date: YYYY-MM-DD
branch: <current branch>
verdict: approve | request-changes | block
---

# Review Report

## Plan Review

### Root Cause Coverage
<Does the plan address the root cause from analysis.md? yes/no + explanation>

### Scope Check
<Any unnecessary changes? Anything missing?>

### Test Coverage
<Does the test plan adequately verify the fix?>

## Code Review

### Correctness
<Does the code fix the root cause?>

### Style
<Does it match existing patterns?>

### Side Effects
<Could this break anything?>

### Issues Found
<numbered list of specific issues with file:line>
<If none: "None.">

## Verdict: <approve | request-changes | block>

<One-line justification>

### Action Items
<If request-changes or block, list what needs to change>
<If approve: "None — ready to ship.">
```
