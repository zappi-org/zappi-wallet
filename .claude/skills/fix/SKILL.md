---
name: fix
description: Fix test failures reported in test-report.md. Reads failures, applies one round of fixes, re-runs tests. No retry loop. Use when user says "/fix", "테스트 고쳐", or when /go detects test failures. Outputs to .pipeline/fix-report.md.
---

# Fix

Read test failures from `.pipeline/test-report.md`, fix them, re-run tests once.

## Input

`.pipeline/test-report.md` — the Failures sections.

## Workflow

### Step 1: Read Failures
Parse each failure: file path, test name, error message, stack trace.

### Step 2: Diagnose
For each failure, determine:
- Is it a code bug? → fix the source code
- Is it a test bug? → fix the test
- Is it a type error? → fix the type

Read the relevant source and test files to understand the failure.

### Step 3: Fix
Apply fixes. Follow the same style rules as `/implement`:
- Read before editing
- Match existing code style
- Minimal changes — fix the failure, nothing else

### Step 4: Re-run & Report
Run `npx vitest run` and `npx tsc --noEmit` once.
Write results to `.pipeline/fix-report.md`.
Commit if all tests pass.

**No retry loop.** If tests still fail after one fix attempt, report the remaining failures and stop.

## Output

Write to `.pipeline/fix-report.md`. Follow format in [references/output-format.md](references/output-format.md).

## Rules

- One round of fixes only. No loops.
- Do NOT change test expectations to make tests pass (unless the expectation is genuinely wrong).
- If a failure is ambiguous (could be code or test bug), assume code bug first.
- Commit message: `fix: resolve test failures from <branch>`
