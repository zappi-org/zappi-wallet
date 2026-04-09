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
ui/ → core/ports → core/services → core/ports/driven → adapters/ | modules/
      composition/ wires everything. Cross-cutting: store/, i18n/, utils/
```

Full layer map in [references/layer-rules.md](references/layer-rules.md).

## Quick Start

1. Run the violation scanner:
   ```
   node ~/.claude/skills/hex-review/scripts/check-hex-violations.mjs <src-dir>
   ```
   Default `<src-dir>` is `./src`.

2. Review the output — each violation shows: file, line, illegal import, and which rule it breaks.

3. For each violation decide: refactor to use a port, move the code to the correct layer, or mark as accepted (`// hex-ignore`).

## Rules Summary (6 rules)

| # | Rule | Severity | Forbidden Pattern |
|---|------|----------|-------------------|
| R1 | Core must not import outside core | critical | `core/**` → anything except `core/**` |
| R2 | Module internal must not import ui/composition/adapters | high | `modules/*/internal/**` → `ui/**`, `composition/**`, `adapters/**` |
| R3 | Adapters must not cross-reference | medium | `adapters/A/**` → `adapters/B/**` |
| R4 | UI must not import adapters/modules/composition | high | `ui/**` → `adapters/**`, `modules/**`, `composition/**` |
| R5 | Composition must not import ui | medium | `composition/**` → `ui/**` |
| R6 | Core services must use ports, not concrete | medium | `core/services/**` → `adapters/**`, `modules/*/internal/**` |

For the full rule definitions with rationale, see [references/layer-rules.md](references/layer-rules.md).

## Workflow

```
Task Progress:
- [ ] Run scanner on src/
- [ ] Group violations by rule
- [ ] For each group: assess severity (critical > high > medium)
- [ ] Propose fix or hex-ignore annotation for each
- [ ] Re-run scanner to confirm zero violations (excluding hex-ignore)
```

## Interpreting Results

- **R1 violations** are critical — core purity is non-negotiable
- **R2 violations** indicate module internals reaching into wrong layers
- **R3 violations** often indicate missing ports (shared logic between adapters)
- **R4 violations** are the most impactful — UI must not know about concrete implementations
- **R5 violations** mean composition depends on presentation (inversion of control broken)
- **R6 violations** suggest the service should receive deps via constructor injection
