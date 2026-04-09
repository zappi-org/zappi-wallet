# Architecture — Hexagonal (Ports & Adapters)

## Core Rule

**The inside never knows the outside.** All dependencies point inward.

## Hexagon Layers (inside → outside)

```
domain/ (innermost) → ports/ (boundary) → services/ (application) → outside
```

- `domain/` — Pure types and functions. Imports nothing.
- `ports/` — Interfaces only. References domain types only.
- `services/` — UseCase implementations. References domain + ports only. Knows nothing about the outside.

## Driving vs Driven

```
Driving Adapter → UseCasePort → Service → DrivenPort ← Driven Adapter
```

**Driving (outside calls inside):**
- `hooks/` — React hooks. Calls UseCase ports.
- `watchers/` — Lifecycle, network events. Calls UseCase ports. No business logic.

**Driven (inside defines, outside implements):**
- `modules/` — Implements WalletModule, PaymentMethodAdapter. Encapsulates SDKs.
- `adapters/storage/` — Implements Repository ports. Encapsulates DB.

## Directory Structure

```
src/
├── core/
│   ├── domain/           # Amount, Transaction, Result<T,E>
│   ├── ports/
│   │   ├── driving/      # PaymentUseCase, BalanceUseCase, NfcCardUseCase, SwapUseCase
│   │   └── driven/       # WalletModule, PaymentMethodAdapter, SwapProvider, *Repository
│   ├── events/           # EventBus, DomainEvent types
│   └── errors/           # Domain errors (no SDK names)
├── modules/              # WalletModule implementations
│   ├── cashu/
│   │   ├── cashu.module.ts
│   │   ├── internal/     # Coco SDK (NEVER import from outside this dir)
│   │   ├── adapters/     # cashu:lightning, cashu:ecash
│   │   └── capabilities/ # nfc-card ops
│   ├── fedimint/
│   └── onchain/
├── services/             # UseCase implementations
│   ├── payment/          # PaymentService, BalanceAggregator
│   ├── swap/             # SwapService + providers/
│   └── nfc-card/
├── adapters/storage/     # Repository implementations
│   └── dexie/
├── vault/                # Non-monetary (gift card, membership, ticket) — fully independent
├── watchers/             # Background driving adapters
├── hooks/                # React driving adapters
├── store/                # Zustand — reactive cache between EventBus and UI
├── ui/
├── app/                  # AppManager, ModuleRegistry, SeedManager
└── bootstrap.ts          # Composition root — only place that knows everything
```

## Import Rules

| From | Can import | CANNOT import |
|------|-----------|---------------|
| `core/domain/` | nothing | everything |
| `core/ports/` | `core/domain/`, `core/errors/` | everything else |
| `core/events/` | `core/domain/` | everything else |
| `services/` | `core/` | `modules/`, `ui/`, `hooks/`, `store/` |
| `modules/` | `core/` | `services/`, `ui/`, `hooks/`, `store/`, other `modules/` |
| `modules/*/internal/` | own module + `core/` | everything outside own module |
| `adapters/storage/` | `core/` | `services/`, `modules/`, `ui/` |
| `hooks/` | `core/ports/driving/`, `store/` | `services/`, `modules/` |
| `watchers/` | `core/ports/driving/` | `services/`, `modules/`, `store/` |
| `store/` | `core/domain/` types only | `services/`, `modules/` |
| `vault/` | own code, `cashu-ts` utils | `modules/`, `services/` |
| `bootstrap.ts` | **everything** | — |

## Key Patterns

### UX Flow: Account → Method → Execute
User selects wallet (mint/account) first, then chooses method, then executes.
```
getAccounts() → getMethodsForAccount(id) → send({ accountId, adapterId, ... })
```
No auto-routing. User decides source and method.

### EventBus vs Store
- **EventBus** — Inside hexagon. Event propagation between services. Services never import store.
- **Store (Zustand)** — Outside hexagon. Reactive cache. Bootstrap connects EventBus → Store.
```
Service → eventBus.emit() → bootstrap handler → store.setState() → React re-render
```

### Error Boundaries (3 boundaries, 3 transformations)
1. SDK error → Domain error (in `modules/*/internal/`)
2. Domain error → `Result<T, E>` (in `services/`, never throw)
3. `Result.error` → UI display (in `hooks/`)

### Two Types of DB
- **Module-internal DB** — Coco manages its own proofs/quotes. App never accesses directly.
- **App-level DB** — Transactions, settings, contacts. Via Repository port. Dexie/SQLite swappable.

### Receive Flow is 2-Phase Async
1. `createReceiveRequest()` — Sync. Returns invoice/QR.
2. Coco Watcher detects payment — Async. Fires event → EventBus → Store → UI.

### Non-Monetary Services (vault/)
Gift cards, memberships, tickets use `TokenVault` + `cashu-ts` codec.
Completely independent from modules/services/EventBus. Separate design.

## Module System

Each SDK = one `WalletModule`. Provides `PaymentMethodAdapter[]` + `ModuleCapability[]`.
```
CashuModule    → cashu:lightning, cashu:ecash, nfc-card capability
FedimintModule → fedi:lightning, fedi:ecash
OnchainModule  → onchain:btc
```

- Single seed, module-specific derivation paths.
- Modules enabled/disabled in settings.
- `internal/` is NEVER imported from outside its module.
- New module = implement WalletModule + register in bootstrap. Zero changes to existing code.

## Adding New Things

| What | Where | Existing code changes |
|------|-------|-----------------------|
| New WalletModule | `modules/new/` + bootstrap register | 0 |
| New PaymentMethodAdapter | inside existing module `adapters/` | 0 |
| New monetary service | `core/ports/driving/` + `services/` + bootstrap | 0 |
| New non-monetary service | `vault/new/` | 0 |
| New SwapProvider | `services/swap/providers/` + bootstrap | 0 |
| New Repository | `core/ports/driven/` + `adapters/storage/` + bootstrap | 0 |
| New protocol (bolt12) | inside module adapter | 0 |

**Pattern: new files first, only bootstrap registration touches existing code.**

## Reference Docs
- `docs/hexagonal-refactoring-guide-v2.md` — Full architecture guide with diagrams
- `docs/hexagonal-code-examples.md` — Code examples per layer + flow traces
- `docs/multi-sdk-architecture-draft_v3.md` — Multi-SDK design decisions
