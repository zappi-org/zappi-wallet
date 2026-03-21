---
name: implement
description: Implement code changes from an approved plan. Reads .pipeline/plan.md, creates branch, writes code matching project style, adds tests, commits. Use when user says "/implement", "구현해", or as first step of "/go" pipeline. Outputs to .pipeline/implement-report.md.
---

# Implement

Read `.pipeline/plan.md` and write production code.

## Input

- `.pipeline/plan.md` — the approved plan (Change Spec + Test Plan)
- `.pipeline/analysis.md` — for context on root cause and affected files

## Workflow

### Step 1: Branch
Create branch from current HEAD. Name: `<type>/<slug>` where:
- type: `fix` or `feat` (from analysis.md type field)
- slug: kebab-case from plan title, max 5 words

**유저 승인 필요:** 브랜치 생성 전에 브랜치 이름을 유저에게 보여주고 승인을 받는다.

### Step 2: Style Discovery
Read the files listed in Change Spec + 1-2 neighboring files to learn:
- Import ordering and style
- Naming conventions (camelCase, kebab-case, etc.)
- Component patterns (hooks, props, state management)
- Error handling patterns

Match existing style exactly. Do not introduce new patterns.

### Step 3: Code
For each file in Change Spec:
- Read the current file
- Implement the pseudocode as real code, following discovered style
- If a better approach than the pseudocode is found, note it in the report

**Autonomy rules:**
- Fix lint/typecheck errors automatically
- Fix minor deviations from plan automatically
- **STOP and propose** if: schema changes, type signature breaking changes, or scope beyond plan

### Step 4: Tests
Implement the tests from plan.md Test Plan section:
- Match existing test patterns (see `src/__tests__/` for conventions)
- Run tests to verify they pass

### Step 5: Verify & Commit
1. Run `npx tsc --noEmit` — fix type errors if any
2. Run `npx eslint <changed source files>` — fix lint errors if any
3. Run `npx vitest run <changed test files>` — fix failures if any
4. Stage all changed files
5. **유저 승인 필요:** 커밋 메시지와 변경 파일 목록을 유저에게 보여주고 승인을 받는다.
6. Commit with message: `<type>: <plan title summary>`
   - Include `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`
7. Write report to `.pipeline/implement-report.md`

## Output

Write to `.pipeline/implement-report.md`. Follow format in [references/output-format.md](references/output-format.md).
Show a summary to the user: branch name, files changed, test results, any deviations from plan.

## Rules

- **브랜치 생성, 커밋, 푸쉬는 항상 유저 승인 후 실행한다.** 자동으로 브랜치를 만들거나 커밋/푸쉬하지 않는다.
- **`.pipeline/` 파일은 git에 올리지 않는다.** 커밋 시 `.pipeline/` 경로의 파일을 staging하지 않는다. 이 디렉토리는 로컬 작업용이다.
- Read actual code before editing. Never edit blind.
- One commit for the entire change.
- If plan's pseudocode conflicts with existing code style, follow existing style.
- Never skip tests. If plan has no Test Plan, add basic regression tests anyway.
