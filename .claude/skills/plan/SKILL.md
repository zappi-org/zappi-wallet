---
name: plan
description: Generate implementation plan from analysis. Reads .pipeline/analysis.md, produces approach candidates with recommendation, file change list with pseudocode, and test plan. Use when user says "/plan", "플랜 짜줘", or as second step of "/start" pipeline. Outputs to .pipeline/plan.md.
---

# Plan

Read `.pipeline/analysis.md` and produce an implementation plan for review.

## Input

`.pipeline/analysis.md` — trust the analysis. Do not re-explore the codebase. Use the Affected Files list and Root Cause as ground truth.

## Workflow

### Step 1: Approach Candidates
List 2-3 approaches to solve the problem. For each:
- One-line description
- Pros / Cons
- Structural impact (which layers change)

Then state the recommended approach and why.

For trivial fixes (single prop removal, value change), skip candidates. Just state the fix.

### Step 2: Change Spec
For the recommended approach, list every file that changes:
- File path
- One-line description of what changes
- Pseudocode showing the change logic (not full code — `/implement` writes real code)

Pseudocode should be specific enough that `/implement` can write the code without ambiguity, but not so detailed that it's actual code.

### Step 3: Test Plan
List tests to add or modify. For each:
- Test file path (existing or new)
- What to test (pseudocode level)
- Type: unit (Vitest) or e2e (Playwright)

### Step 4: Risk Check
- What could break? (regression risk)
- Edge cases to watch
- Anything that needs manual QA on real device

## Output

Write to `.pipeline/plan.md`. Follow format in [references/output-format.md](references/output-format.md).
Show a summary to the user: recommended approach + file list + key risk.

## Rules

- Do NOT read source code. Trust analysis.md.
- Pseudocode, not real code. Leave implementation to `/implement`.
- If analysis is insufficient, say what's missing. Do not guess.
- Trivial fixes get minimal plans. Don't over-engineer the plan itself.
- Approach candidates must follow the project's existing design patterns and architecture. Do not propose patterns that don't already exist in the codebase.
