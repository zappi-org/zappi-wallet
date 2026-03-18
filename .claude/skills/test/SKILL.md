---
name: test
description: Run full test suite (Vitest + Playwright) and generate test report. Use when user says "/test", "테스트 돌려", or as part of "/go" pipeline. Outputs to .pipeline/test-report.md.
---

# Test

Run the full test suite and report results.

## Workflow

### Step 1: Vitest
Run `npx vitest run` (full suite). Capture output.

### Step 2: Type Check
Run `npx tsc --noEmit`. Capture output.

### Step 3: Playwright
Check if Playwright is configured (`npx playwright --version` and playwright config file exists).
- If configured: run `npx playwright test`. Capture output.
- If not configured: report "Playwright not set up" in the report. Do NOT attempt to install or configure.

### Step 4: Report
Write results to `.pipeline/test-report.md`. Follow format in [references/output-format.md](references/output-format.md).
Show summary to user: pass/fail counts, any failures with file:line.

## Rules

- Run the FULL test suite, not just changed files.
- Do NOT fix failures. Report them. Fixes are `/fix`'s job.
- Do NOT modify any code or test files.
- If a test is flaky (passes on retry), note it in the report.
