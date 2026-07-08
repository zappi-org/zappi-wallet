# Contributing

## Architecture

Hexagonal (ports & adapters). All dependencies point inward. See `AGENTS.md` for details.

## Rules

**Event Bus** — All cross-cutting communication through `EventBus` (`src/core/events/event-bus.ts`). Services emit events, bridges consume them. Services never import the store. `TransferLifecycleService` is the central lifecycle system for transfers.

**Domain Purity** — `src/core/domain/` must have no I/O, no SDK imports, no protocol names (`cashu`, `nostr`, `bolt11`, `NUT`, `NIP`, etc.). There are existing violations — contributions to remove them are welcome.

**Storage** — Use Dexie.js (IndexedDB) in `src/adapters/storage/dexie/`. Schema changes bump the version. No in-app migration code (no upgrade callbacks, no row conversion). Existing soft-migration patterns should be eliminated — contributions welcome.

**UI/UX** — Open an issue and discuss first before implementing.

**Before every PR**, run:

```bash
tsc -b
bun lint
bun run test
bunx changeset
```
