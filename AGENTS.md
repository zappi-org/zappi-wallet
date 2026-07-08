# Zappi Wallet — Architecture Guide

## Structure

- **`src/core/`** — Hexagonal boundary. Pure, no framework deps.
  - `domain/` — Pure types & functions (Amount, Transaction, Result<T,E>)
  - `ports/driving/` — UseCase interfaces (Payment, Balance, Swap, Transfer, ...)
  - `ports/driven/` — Port interfaces (NostrGateway, WalletModule, repos, ...)
  - `services/` — UseCase implementations
  - `events/` — EventBus + DomainEvent types
  - `errors/` — Domain errors (69 error codes)
  - `constants/` — Domain constants (fiat, NUTs)
  - `types/` — Shared domain types
- **`src/modules/cashu/`** — WalletModule impl (Coco SDK, bolt11/ecash). `internal/` must never be imported from outside.
- **`src/adapters/`** — 14 driven port implementation areas (nostr, storage, crypto, lnurl, coco, codec, cache, exchange-rate, health, metadata, nip05, runtime, customer-support, zappi-link)
- **`src/composition/`** — Wiring layer, NOT inside hexagon. `bootstrap.ts` is the composition root. Contains bridges (event-store, coco-event, transfer-tx, gift-wrap-settlement), observers, routing, and factory modules.
- **`src/store/`** — Zustand reactive cache, outside hexagon. `slices/` for domain slices, `selectors/` for derived state.
- **`src/ui/`** — Screens (20), components, primitives, hooks (access core via ServiceRegistry), config.
- **`src/i18n/`** — Internationalization with locales: en, ko, ja, es, id
- **`src/__tests__/`** — Tests mirroring `src/` structure (unit/, mocks/)
- **`src/utils/`** — Pure utility functions
- **`src/assets/`** — Static assets

## Flow

```
UI (hooks)
    ↓ ServiceRegistry
Driving Port (UseCase interface)
    ↓
Service (implements UseCase, calls driven ports)
    ↓
Driven Port (interface)
    ↑
Adapter (implements port — SDK, DB, network)
```

```
Watcher → Driving Port → Service → Driven Port ← Adapter
    ↓
EventBus → EventStoreBridge → Store → UI re-render
```

## Rules

### R1 — Dependency direction is always inward

`domain/` imports nothing. `ports/` imports only domain. `services/` imports only domain + ports.
Adapters, hooks, store, UI — all outside the hexagon, all depend inward.

### R2 — Domain purity

Domain types and functions must be pure. No I/O, no framework imports, no SDK types.
If a function needs I/O, it belongs in a service. If a type references an SDK, it belongs in an adapter.

### R3 — Port neutrality

Ports must be protocol-agnostic. No protocol names, SDK types, or transport details in port interfaces.

| Bad | Good |
|-----|------|
| `sendCashuToken()` | `send({ token, recipient })` |
| `NUT18Payload` in port params | `{ token, memo, requestId }` |
| `nostrRelay: string[]` in port | Adapter resolves relays internally |
| `SimplePool` in port | Port says `subscribe()`, adapter uses SimplePool |

The port describes **what** the app needs. The adapter decides **how**.

### R4 — Composition root is the only boundary crosser

Only `composition/bootstrap.ts` may import from all layers. It wires adapters to ports, creates services, and exposes `ServiceRegistry`. Everything else imports only what its layer allows.

### Import rules

| From | Can import | CANNOT import |
|------|-----------|---------------|
| `core/domain/` | nothing | everything |
| `core/ports/` | `core/domain/`, `core/errors/` | everything else |
| `core/services/` | `core/` only | `modules/`, `adapters/`, `hooks/`, `store/`, `ui/` |
| `modules/` | `core/` | `services/`, `adapters/`, `hooks/`, `store/`, other `modules/` |
| `adapters/` | `core/` | `services/`, `hooks/`, `store/`, `ui/` |
| `hooks/` | `core/ports/driving/` types, `store/`, `composition/types` | `services/`, `modules/`, `adapters/` |
| `composition/` | **everything** | — |

### EventBus vs Store

- **EventBus** — inside hexagon. Services emit domain events. Services never import store.
- **Store** — outside hexagon. Reactive cache for UI. `EventStoreBridge` connects EventBus → Store.

```
Service → eventBus.emit() → EventStoreBridge → store.setState() → React re-render
```
