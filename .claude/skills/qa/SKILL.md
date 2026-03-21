---
name: qa
description: Generate manual QA checklist from git diff and plan. For real-device testing scenarios that automated tests cannot cover. Use when user says "/qa", "QA 체크리스트", or as part of "/go" pipeline. Outputs to .pipeline/qa-checklist.md.
---

# QA

Generate a manual QA checklist for real-device testing.

## Input

- `git diff` of the current branch vs base — what actually changed
- `.pipeline/plan.md` — Risk Check section, affected flow, edge cases

## Workflow

### Step 1: Diff Analysis
Detect base branch: check which branch the current branch was created from (e.g., nightly, staging, main). Run `git diff <base-branch>...HEAD` to see all changes.
Identify which screens, flows, and user interactions are affected.

### Step 2: Read Plan Context
Read `.pipeline/plan.md` Risk Check section for:
- Known regression risks
- Edge cases
- Manual QA items already identified

### Step 3: Generate Checklist
Create a checklist covering:
- **Happy path**: the fix/feature works as intended
- **Regression**: surrounding features still work
- **Edge cases**: from plan + anything obvious from the diff
- **Platform-specific**: iOS Safari, Android Chrome, PWA standalone mode
- **Interaction**: keyboard, touch, gestures relevant to the change

### Step 4: Write
Write to `.pipeline/qa-checklist.md`. Follow format in [references/output-format.md](references/output-format.md).

## Rules

- Checklist items must be actionable: specific steps, not vague descriptions.
- Keep it focused. 5-15 items. Don't test unrelated flows.
- Mark items that are critical vs nice-to-have.
