---
name: hex-review
description: "SUBAGENT-ONLY skill. Audit hexagonal architecture violations by scanning import paths. Trigger: 'hex review', 'architecture check', 'layer violation'. EXECUTION: Do NOT run inline. ALWAYS spawn a subagent via the Agent tool with ONLY the scan target path. No conversation context should be forwarded."
---

# Hexagonal Architecture Review

Scan source files for import-path violations across hexagonal layer boundaries.

## Execution Model (MANDATORY)

**This skill MUST be run as a subagent.** Never run inline in the main conversation.

When triggered, the parent agent MUST:

1. Spawn a subagent via the Agent tool
2. Pass ONLY the scan target directory — no other conversation context
3. The subagent reads this skill file, runs the script, and returns results

```
Agent(
  description: "Hex architecture review",
  prompt: "You are a hexagonal architecture auditor. Read ~/.claude/skills/hex-review/SKILL.md and ~/.claude/skills/hex-review/references/layer-rules.md for rules. Run: node ~/.claude/skills/hex-review/scripts/check-hex-violations.mjs <src-dir>. Analyze the output. Return a structured report: violations grouped by rule, severity, and suggested fix for each.",
)
```

Replace `<src-dir>` with the actual source directory (e.g., `/path/to/project/src`).

## Layer Model

```
  Driving          Core               Driven
  ───────    ┌──────────────┐    ──────────
  UI/CLI  →  │ domain/      │  ← adapters/
  tests   →  │ ports/       │  ← modules/internal/
             └──────────────┘    data/ (legacy)
```

**Dependency rule**: arrows point inward. No outward imports from core. No cross-adapter imports. No legacy bypass.

## Quick Start

1. Run the violation scanner:
   ```
   node ~/.claude/skills/hex-review/scripts/check-hex-violations.mjs <src-dir>
   ```
   Default `<src-dir>` is `./src`.

2. Review the output — each violation shows: file, line, illegal import, and which rule it breaks.

3. For each violation decide: refactor to use a port, move the code to the correct layer, or mark as accepted legacy (with comment `// hex-ignore`).

## Rules Summary

| # | Rule | Forbidden Pattern |
|---|------|-------------------|
| 1 | Core must not import outside core | `core/**` → anything except `core/**` |
| 2 | Module internal must not import legacy | `modules/*/internal/**` → `data/**`, `coco/**` |
| 3 | Adapters must not cross-reference | `adapters/A/**` → `adapters/B/**` |
| 4 | Services must use ports, not concrete | `services/**` → `data/**`, `modules/*/internal/**` |

For the full rule definitions with rationale and examples, see [references/layer-rules.md](references/layer-rules.md).

## Workflow

```
Task Progress:
- [ ] Run scanner on src/
- [ ] Group violations by rule
- [ ] For each group: assess severity (hard violation vs legacy compat)
- [ ] Propose fix or hex-ignore annotation for each
- [ ] Re-run scanner to confirm zero violations (excluding hex-ignore)
```

## Interpreting Results

- **Rule 1 violations** are critical — core purity is non-negotiable
- **Rule 2 violations** are the most common during migration — module internals reaching into legacy data/coco layers
- **Rule 3 violations** often indicate missing ports
- **Rule 4 violations** suggest the service should inject via constructor, not import directly
