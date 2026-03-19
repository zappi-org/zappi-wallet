---
name: analyze
description: Analyze bug reports or feature requests by exploring the codebase. Identifies root causes, traces call chains, checks existing safeguards. Use when user says "/analyze", "분석해", "조사해", or as first step of "/start" pipeline. Outputs to .pipeline/analysis.md.
---

# Analyze

Produce a structured root-cause analysis (bug) or impact analysis (feature) by exploring the codebase.

## Workflow

5 steps. Do not skip any.

### Step 1: Entry Point
Identify the screen/component where the symptom occurs. Find the exact file and handler.

### Step 2: Call Chain Trace
Follow the full execution path from UI → hook → service → data layer. Use parallel Agent(Explore) calls to trace:
- UI layer (screens, components, handlers)
- Logic layer (hooks, services, utils)
- Data layer (store slices, repositories, database)

Do NOT stop at the first match. Trace until you hit the terminal point (database write, API call, or state update).

### Step 3: Lifecycle & State
Check what triggers the code and what kills it:
- useEffect dependencies and cleanup functions
- Component mount/unmount conditions (conditional rendering, navigation)
- Polling/subscription start and stop conditions
- State machine transitions

### Step 4: Safeguard Audit
Check existing protective mechanisms:
- Error handlers, recovery logic, retry mechanisms
- Does any existing code cover this scenario?
- If safeguards exist but don't work for this case, explain why

### Step 5: Root Cause
State the root cause in one sentence, then support with file:line references.

## Output

Write to `.pipeline/analysis.md`. Follow format in [references/output-format.md](references/output-format.md).
Show a brief summary to the user after writing.

## Rules

- Every claim must reference a specific `file_path:line_number`
- Trace the FULL call chain, not just the entry point
- Note existing test coverage (or lack of it)
- Classify as `bug` or `feature`
- If root cause is ambiguous, list candidates ranked by likelihood
