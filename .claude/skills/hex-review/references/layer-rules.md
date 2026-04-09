# Hexagonal Layer Rules

## Rule 1: Core Isolation

**Core** (`core/domain/**`, `core/ports/**`) must NEVER import from:
- `adapters/**`
- `modules/**`
- `data/**`
- `services/**`
- `ui/**`
- `coco/**`
- Any external SDK/framework (except pure type imports from standard libs)

**Why**: Core is the innermost ring. If it depends on anything outside, swapping adapters breaks the domain.

**Allowed**: core importing other core files (`core/domain/amount` from `core/ports/driven/...`).

## Rule 2: Module Internal Isolation

**Module internals** (`modules/*/internal/**`) must NOT import from:
- `data/database/**` (direct DB schema access)
- `data/repositories/**` (legacy repository singletons)
- `coco/**` (legacy compatibility layer)

**Why**: Module internals wrap an SDK (e.g., Coco). If they also reach into the DB or legacy layer, the module cannot be tested in isolation and changes to the DB schema ripple into module code.

**Allowed**: Module internals importing their own SDK (`@cashu/cashu-ts`, `coco-cashu-core`). The SDK is the module's raison d'etre.

## Rule 3: No Adapter Cross-Reference

An adapter in `adapters/A/**` must NOT import from `adapters/B/**`.

**Why**: Adapters are interchangeable implementations of ports. If adapter A depends on adapter B, replacing B breaks A. Shared logic should live in a port or domain service.

**Example violation**: `adapters/nostr/nostr-gateway.ts` importing `adapters/storage/dexie/...`

## Rule 4: Services Use Ports

**Services** (`services/**`) must NOT import from:
- `data/**` (bypasses repository ports)
- `modules/*/internal/**` (bypasses module ports)
- Concrete adapter constructors (should receive via DI)

**Allowed**: Services importing from `core/ports/**`, `core/domain/**`.

**Legacy exception**: `services/**` importing from `coco/**` is a known legacy cleanup target. Flag but don't block.

## Escape Hatch: hex-ignore

Add `// hex-ignore` on the import line to suppress a specific violation. Use sparingly — only for legacy compatibility layers explicitly marked for future deletion.

```typescript
import { getDatabase } from '@/data/database/schema' // hex-ignore: legacy cleanup planned
```

## Severity Levels

| Severity | Meaning | Action |
|----------|---------|--------|
| **critical** | Rule 1 violation (core impurity) | Fix immediately |
| **high** | Rule 2 violation (module bypass) | Fix in current phase |
| **medium** | Rule 3 violation (adapter coupling) | Fix before next phase |
| **low** | Rule 4 violation with `// hex-ignore` | Track for legacy cleanup |
