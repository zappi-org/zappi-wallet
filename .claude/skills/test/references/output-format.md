# Test Report Format

Write to `.pipeline/test-report.md`.

```markdown
---
date: YYYY-MM-DD
branch: <current branch>
status: pass | fail
---

# Test Report

## Summary

- Vitest: <pass/fail> (<passed>/<total> tests)
- Type check: <pass/fail>
- Playwright: <pass/fail/not configured>

## Vitest Results

```
<output summary — test files, pass/fail counts, duration>
```

### Failures
<list each failure with file path, test name, and error message>
<If none: "None.">

## Type Check Results

```
<tsc output or "No errors.">
```

## Playwright Results

```
<output summary or "Not configured.">
```

### Failures
<list each failure>
<If none or not configured: "N/A">
```
