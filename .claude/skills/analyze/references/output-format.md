# Analysis Output Format

Write to `.pipeline/analysis.md` using this structure.

```markdown
---
type: bug | feature
date: YYYY-MM-DD
input: "<original user input verbatim>"
---

# Analysis: <one-line title>

## Summary

<2-3 sentences. What is the problem/request and what causes it.>

## Classification

- Type: bug | feature
- Severity: critical | high | medium | low
- Affected flow: <user-facing flow name>

## Entry Point

- Screen: `file_path:line` — <component name>
- Trigger: <what user action starts this flow>

## Call Chain

Full execution path from UI to terminal point.

```
ComponentA.handler()          — file_path:line
  → HookB.method()           — file_path:line
    → ServiceC.function()    — file_path:line
      → Repository.write()   — file_path:line
```

## Lifecycle & State

- Mount condition: <when does the relevant component mount>
- Unmount condition: <when does it unmount>
- Cleanup: <what useEffect cleanup does>
- State transitions: <relevant state changes>

## Safeguard Audit

| Mechanism | Location | Covers this case? | Why/why not |
|-----------|----------|-------------------|-------------|
| <name>   | file:line | yes/no           | <reason>    |

## Root Cause

<One sentence stating the root cause.>

<Supporting evidence with file:line references.>

## Existing Test Coverage

- <list relevant existing tests, or "None">

## Affected Files

List every file that needs changes to fix this (for /plan to consume):

- `file_path` — <what needs to change>
```

## Notes

- Lifecycle & State section can be omitted for feature requests
- Safeguard Audit can be brief if no existing mechanisms exist
- Affected Files is consumed by /plan — be thorough
