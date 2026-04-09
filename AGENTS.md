# Zappi Wallet — Architecture Guide

## Structure

```
src/
├── core/                    # Hexagonal boundary — pure, no framework deps
│   ├── domain/              # Pure types & functions (Amount, Transaction, Result<T,E>)
│   ├── ports/
│   │   ├── driving/         # 13 UseCases (Payment, Balance, Swap, IncomingPayment, ...)
│   │   └── driven/          # 26 ports (NostrGateway, OutgoingPaymentTransport, repos, ...)
│   ├── services/            # UseCase implementations (13 services)
│   ├── events/              # EventBus + DomainEvent types
│   └── errors/              # Domain errors
├── modules/cashu/           # WalletModule impl — Coco SDK, bolt11/ecash adapters
│   └── internal/            # NEVER import from outside this dir
├── adapters/                # Driven port implementations
│   ├── nostr/               # NostrGatewayAdapter, NostrPaymentTransport, nostr-crypto
│   ├── storage/             # Dexie repos, AnchorStore, RecoveryStore
│   ├── crypto/              # Encryption, KeyManager, P2PK
│   ├── lnurl/               # DirectLnurlAdapter
│   └── ...
├── composition/             # Wiring layer (NOT inside hexagon)
│   ├── bootstrap.ts         # Composition root — only file that knows everything
│   ├── gift-wrap.watcher.ts # GiftWrapWatcher (subscribe → parse → redeem → emit)
│   ├── app-lifecycle.watcher.ts
│   ├── event-store-bridge.ts
│   ├── types.ts             # ServiceRegistry interface
│   └── *.ts                 # Service factory functions
├── hooks/                   # React driving adapters (access core via ServiceRegistry)
├── store/                   # Zustand — reactive cache, outside hexagon
└── ui/                      # Screens, components
```

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
