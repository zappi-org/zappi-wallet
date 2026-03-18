# Plan Output Format

Write to `.pipeline/plan.md` using this structure.

```markdown
---
based_on: .pipeline/analysis.md
date: YYYY-MM-DD
status: pending_review
---

# Plan: <one-line title matching analysis>

## Approach Candidates

### Option A: <name>
<one-line description>
- Pros: ...
- Cons: ...
- Impact: <which layers/files change>

### Option B: <name>
<one-line description>
- Pros: ...
- Cons: ...
- Impact: <which layers/files change>

### Recommendation
<which option and why, in 1-2 sentences>

## Change Spec

### `file_path`
<one-line: what changes>
```pseudo
// pseudocode showing the change
// be specific enough for /implement to write real code
```

### `another_file_path`
<one-line: what changes>
```pseudo
// pseudocode
```

## Test Plan

### Unit Tests (Vitest)
- `test_file_path` — <what to verify>
  ```pseudo
  // test pseudocode
  ```

### E2E Tests (Playwright)
- `test_file_path` — <what to verify>
  ```pseudo
  // test pseudocode
  ```

## Risk Check

- Regression: <what could break>
- Edge cases: <list>
- Manual QA needed: <yes/no + what to check on real device>
```

## Notes

- For trivial fixes: skip Approach Candidates, go straight to Change Spec
- Test Plan can omit E2E section if not needed
- status field is consumed by /start orchestrator
