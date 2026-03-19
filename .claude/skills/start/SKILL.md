---
name: start
description: "Pipeline entry point: analyze + plan, then pause for user review. Use when user says \"/start <bug or feature description>\". Orchestrates /analyze → /plan → shows result and waits."
---

# Start

Orchestrate analysis and planning, then pause for user decision.

## Input

User provides a bug report or feature request as argument.

## Workflow

### Step 1: Clean Pipeline
Delete all existing `.pipeline/*.md` files to start fresh.
Create `.pipeline/` directory if it doesn't exist.

### Step 2: Save Input
Write the raw user input to `.pipeline/input.md`.

### Step 3: Analyze
Run `/analyze` with the user's input.
Wait for `.pipeline/analysis.md` to be written.

### Step 4: Plan
Run `/plan`.
Wait for `.pipeline/plan.md` to be written.

### Step 5: Present
Show the user:
1. Analysis summary (root cause, severity)
2. Plan summary (recommended approach, file list, risk)
3. Ask: **승인 / 수정 요청 / 반려**

## After User Decision

- **승인** → user runs `/go`
- **수정 요청** → user gives feedback, run `/plan` again (analysis stays)
- **반려** → pipeline ends, `.pipeline/` can be cleaned up

## Rules

- Always clean `.pipeline/` before starting. Stale artifacts from previous runs cause confusion.
- Do NOT proceed to `/implement` automatically. Always pause after plan.
- Present results concisely. User should be able to decide in under 30 seconds.
