/**
 * Cashu module assembly (extracted from bootstrap.ts).
 */

// ─── Store (composition root only) ───
import { useAppStore } from "@/store";

// ─── Modules (bootstrap-only import) ───
import { CashuModule } from "@/modules/cashu/cashu.module";
import { createCashuBackend } from "@/modules/cashu/create-cashu-backend";

import { DexieOfflineTokenStore } from "@/adapters/storage/dexie/dexie-offline-token-store";

import type { WalletModule } from "@/core/ports/driven/wallet-module.port";
import type { EventBus } from "@/core/events/event-bus";
import type { DexiePendingOperationRepository } from "@/adapters/storage/dexie/dexie-pending-operation.repository";
import type { DexieTransactionRepository } from "@/adapters/storage/dexie/dexie-transaction.repository";

export function assembleCashuModule(deps: {
  pendingOpRepo: DexiePendingOperationRepository;
  txRepo: DexieTransactionRepository;
  eventBus: EventBus;
}) {
  const { pendingOpRepo, txRepo, eventBus } = deps;

  // (caller invokes initialize() with the seed)
  const offlineTokenStore = new DexieOfflineTokenStore();
  const cashuBackend = createCashuBackend({
    pendingOpRepo,
    txRepo,
    offlineTokenStore,
    getActiveMintUrls: () => useAppStore.getState().settings.mints,
  });
  const cashuModule = new CashuModule(cashuBackend, eventBus);
  const modules: WalletModule[] = [cashuModule];

  return { cashuBackend, cashuModule, modules };
}
