# Refactoring Migration Plan

## Principles

1. **App must work after every phase.** No big-bang rewrites. Every phase ends with passing tests and working app.
2. **New files first, delete last.** Create the new structure alongside the old. Only remove old files after all references are migrated.
3. **One direction of migration.** Old code calls new code (via wrapper). New code never imports old code.
4. **Feature-freeze during Phase 3.** Module extraction is the riskiest phase. No new features until it stabilizes.

---

## Phase Overview

```
Phase 1: Foundation        — core/ scaffolding (domain, ports, events, errors)
Phase 2: Storage           — Repository ports + Dexie adapters
Phase 3: Module Extraction — coco/ + services/ → modules/cashu/
Phase 4: Services          — PaymentService, BalanceAggregator (UseCase impls)
Phase 5: Wiring            — bootstrap, hooks, watchers, store connection
Phase 6: UI Cleanup        — remove direct imports from UI
Phase 7: Delete Old Code   — remove legacy files
```

---

## Phase 1: Foundation

**Goal:** Create `core/` with all types and interfaces. Zero changes to existing code.

**Files created:**
```
core/
├── domain/
│   ├── amount.ts              # Amount, sat(), add(), subtract(), toNumber()
│   ├── transaction.ts         # Transaction, createTransaction(), completeTransaction()
│   └── result.ts              # Result<T,E>, Ok(), Err()
├── ports/
│   ├── driving/
│   │   ├── payment.usecase.ts
│   │   ├── balance.usecase.ts
│   │   ├── nfc-card.usecase.ts
│   │   └── swap.usecase.ts
│   └── driven/
│       ├── wallet-module.port.ts
│       ├── payment-method.port.ts
│       ├── swap-provider.port.ts
│       ├── transaction.repository.port.ts
│       ├── settings.repository.port.ts
│       └── contact.repository.port.ts
├── events/
│   ├── domain-events.ts
│   └── event-bus.ts
└── errors/
    ├── base.error.ts
    └── payment.errors.ts
```

**Existing code changes:** 0
**Risk:** None. Only new files.
**Validation:** Types compile. No runtime impact.

---

## Phase 2: Storage

**Goal:** Wrap existing repositories behind driven ports. Old code still works via wrappers.

**Steps:**
1. Create `adapters/storage/dexie/` with new Repository implementations that use existing Dexie schema
2. Old `data/repositories/*.ts` still exist — not deleted yet
3. New code imports from ports. Old code still imports from `data/repositories/` directly.

**Files created:**
```
adapters/storage/dexie/
├── dexie-transaction.repository.ts   # implements TransactionRepository port
├── dexie-settings.repository.ts
└── dexie-contact.repository.ts
```

**Existing code changes:** 0
**Risk:** Low. New implementations wrap same Dexie DB.
**Validation:** Write adapter tests — same assertions as existing repo tests.

---

## Phase 3: Module Extraction

**Goal:** Extract `coco/cashuService.ts` + `services/payment/routing/` into `modules/cashu/`.

This is the largest and riskiest phase. Split into sub-phases.

### Phase 3a: CashuBackend (internal/)

Extract Coco SDK calls from `cashuService.ts` into `CashuBackend` class.

```
modules/cashu/internal/
├── cashu-backend.ts      # mintQuote, meltQuote, tokenSend, tokenReceive, balance
└── coco-sdk.ts           # Manager initialization, watcher management
```

**Migration strategy:**
- `CashuBackend` wraps the same Coco Manager instance
- `cashuService.ts` functions become thin wrappers that call `CashuBackend`
- Verify: every existing callsite still works through the wrapper

```typescript
// Transitional: cashuService.ts becomes a thin wrapper
import { getCashuBackend } from '@/modules/cashu/internal/cashu-backend'

export async function createMintQuote(mintUrl: string, amount: number) {
  const backend = await getCashuBackend()
  return backend.mintQuote.prepare({ mintUrl, amount, method: 'bolt11' })
}
```

**Validation:** All existing tests pass. No behavior change.

### Phase 3b: Payment Adapters

Extract routing logic into `PaymentMethodAdapter` implementations.

```
modules/cashu/adapters/
├── cashu-lightning.adapter.ts    # melt/mint flows from routing/
└── cashu-ecash.adapter.ts        # token send/receive from cashuService
```

**Migration strategy:**
- Each adapter wraps `CashuBackend` (from 3a)
- Existing `routing/execute-route.ts` functions map to adapter methods
- Old routing code still works — adapters are additive

**Validation:** Adapter unit tests for each payment path.

### Phase 3c: CashuModule

Assemble backend + adapters into `WalletModule` implementation.

```
modules/cashu/cashu.module.ts     # implements WalletModule
```

**Validation:** `CashuModule.getPaymentAdapters()` returns working adapters. `getBalance()` returns correct balances.

---

## Phase 4: Services

**Goal:** Create `PaymentService` and `BalanceAggregator` implementing UseCase ports.

**Files created:**
```
services/payment/
├── payment.service.ts        # implements PaymentUseCase
└── balance-aggregator.ts     # implements BalanceUseCase
```

**Migration strategy:**
- Services use `WalletModule` port (not CashuModule directly)
- Services use `TransactionRepository` port (not Dexie directly)
- Services use `EventBus` for cross-service communication
- At this point, both old path (cashuService → routing) and new path (PaymentService → adapter) exist

**Validation:** Service integration tests — send/receive through new path produces same results as old path.

---

## Phase 5: Wiring

**Goal:** Connect everything via bootstrap. Switch driving adapters to new path.

### Phase 5a: Bootstrap + EventBus

```
bootstrap.ts               # Composition root
app/app-manager.ts          # Module lifecycle
core/events/event-bus.ts    # Already created in Phase 1
```

- Create `bootstrap()` that assembles modules, services, repositories
- Connect Coco events → EventBus → Store
- This runs alongside existing `MainApp.tsx` initialization

### Phase 5b: Hooks

```
hooks/use-payment.ts        # Calls PaymentUseCase (not cashuService)
hooks/use-balance.ts        # Calls BalanceUseCase
hooks/contexts.ts           # React Context for UseCase injection
```

- New hooks call UseCase ports
- Old hooks (`use-payment.ts`) still exist — renamed to `use-payment.legacy.ts`
- UI components switch to new hooks one screen at a time

### Phase 5c: Watchers

```
watchers/app-lifecycle.watcher.ts
watchers/network-recovery.watcher.ts
```

- Replace inline `document.addEventListener` in MainApp with watcher classes
- Watchers call UseCase ports

### Phase 5d: Store Connection

- EventBus → Zustand store (in bootstrap)
- Remove direct `connectCocoToStore()` calls from `coco/bridge.ts`
- Store becomes pure reactive cache

**Validation:** Full app works through new path. Old path still exists but unused.

---

## Phase 6: UI Cleanup

**Goal:** Remove all direct imports of `coco/cashuService`, `services/payment/routing/`, old hooks from UI components.

**Screen by screen:**
1. `SendFlow.tsx` — switch to `usePayment()` (new)
2. `ReceiveFlow.tsx` — switch to `usePayment()` (new)
3. `SendConfirmStep.tsx` — remove `import { prepareMelt } from '@/coco/cashuService'`
4. `HomeScreen.tsx` — switch to `useBalance()` (new)
5. `TransactionDetailScreen.tsx` — switch to new hooks
6. Remaining screens

**Validation per screen:** Manual QA + existing tests. One screen at a time.

---

## Phase 7: Delete Old Code

**Goal:** Remove legacy files. Only after all references are migrated.

**Files to delete:**
```
coco/cashuService.ts          # → modules/cashu/internal/cashu-backend.ts
coco/bridge.ts                # → bootstrap.ts EventBus connection
coco/manager.ts               # → modules/cashu/internal/coco-sdk.ts
coco/seedGetter.ts            # → modules/cashu/internal/ or app/seed-manager.ts
services/payment/routing/     # → modules/cashu/adapters/
services/payment/payment.service.ts (old) # → services/payment/payment.service.ts (new)
hooks/use-payment.legacy.ts   # → deleted
data/repositories/ (old)      # → adapters/storage/dexie/ (already migrated)
```

**Validation:**
- `grep -r "coco/cashuService" src/` returns 0 matches
- `grep -r "services/payment/routing" src/` returns 0 matches
- All tests pass
- Full manual QA

---

## Cautions

### During Phase 3 (Module Extraction)
- **Feature freeze.** No new features until 3c is complete.
- **One function at a time.** Don't extract all 27 cashuService functions at once. Start with `getBalances()` (simplest), end with `recoverPendingSendTokens()` (most complex).
- **Keep the wrapper.** `cashuService.ts` becomes a thin wrapper calling `CashuBackend`. Don't delete it until Phase 7.
- **Test after every function extraction.** If a test breaks, the wrapper is wrong.

### During Phase 5 (Wiring)
- **Two paths coexist.** Old path (cashuService) and new path (PaymentService) both work. This is intentional and temporary.
- **Switch one screen at a time.** Don't switch all hooks at once.
- **Store must not have two writers.** When switching EventBus → Store, disable the old `connectCocoToStore()` bridge at the same time. Never let both write to the same store slice.

### During Phase 6 (UI Cleanup)
- **Don't refactor UI logic.** Only change imports. If `SendFlow` has complex step logic, leave it. Refactoring UI is a separate task.
- **One PR per screen.** Easier to review and revert.

### General
- **Never import old code from new code.** Direction is always: old wrapper → new implementation. If you find new code needing to import from `coco/`, stop and rethink.
- **Don't rename files during extraction.** Create new file, make old file a wrapper, delete old file later. Three steps, not one.
- **Run the full test suite after every sub-phase.** Not just the files you changed.

---

## Timeline Estimate

| Phase | Scope | Relative effort |
|-------|-------|-----------------|
| 1. Foundation | New files only | Small |
| 2. Storage | New files + adapter tests | Small |
| 3a. CashuBackend | Extract 27 functions | **Large** |
| 3b. Adapters | Extract routing logic | Medium |
| 3c. CashuModule | Assembly | Small |
| 4. Services | New UseCase impls | Medium |
| 5. Wiring | Bootstrap + hooks + watchers | Medium |
| 6. UI Cleanup | Screen-by-screen migration | Medium |
| 7. Delete | Remove old files | Small |

Phase 3a is the bottleneck. Everything else flows from it.
