# Hexagonal Layer Rules

## Layer Map

```
ui/           → screens, hooks, components, primitives, utils, lib, services
composition/  → bootstrap, observers, cross-tab-sync
core/         → domain, ports (driving/driven), services, events, errors
adapters/     → driven port implementations (nostr, storage, crypto, ...)
modules/      → SDK integration (cashu/internal, cashu/adapters)
store/        → Zustand (cross-cutting)
i18n/         → i18n (cross-cutting)
utils/        → cross-cutting (format, throttled-async, url)
```

## Rules

### R1: Core Isolation (critical)

`core/**` → only `core/**`. No exceptions.

### R2: Module Internal Isolation (high)

`modules/*/internal/**` must not import `ui/`, `composition/`, `adapters/`.

Allowed: own SDK (`@cashu/cashu-ts`, `coco-cashu-core`), `core/**`.

### R3: No Adapter Cross-Reference (medium)

`adapters/A/**` must not import `adapters/B/**`.

Fix: extract shared logic to a port or domain service.

### R4: UI Uses Ports Only (high)

`ui/**` must not import `adapters/`, `modules/`, `composition/`.

Allowed: `core/**` (ports, domain), `store/`, `i18n/`, `utils/`.

### R5: Composition Must Not Import UI (medium)

`composition/**` must not import `ui/**`.

Allowed: `core/`, `adapters/`, `modules/`, `store/`, `utils/`.

### R6: Core Services Use Ports (medium)

`core/services/**` must not import `adapters/` or `modules/*/internal/`.

Deps via constructor injection only.

## Escape Hatch

`// hex-ignore` on import line suppresses one violation. Requires rationale comment.

## Severity

| Level | Rules | Action |
|-------|-------|--------|
| critical | R1 | Fix immediately |
| high | R2, R4 | Fix before merge |
| medium | R3, R5, R6 | Fix in current sprint |
