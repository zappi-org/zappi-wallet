/**
 * Bootstrap 조각 3 — Cashu 모듈 조립 (bootstrap.ts 순수 이동)
 */

// ─── Store (composition root만 접근) ───
import { useAppStore } from "@/store";

// ─── Modules (bootstrap만 import 허용) ───
import { CashuModule } from "@/modules/cashu/cashu.module";
import { createCashuBackend } from "@/modules/cashu/create-cashu-backend";

import { DexieOfflineTokenStore } from "@/adapters/storage/dexie/dexie-offline-token-store";

import type { WalletModule } from "@/core/ports/driven/wallet-module.port";
import type { EventBus } from "@/core/events/event-bus";
import type { NostrGatewayAdapter } from "@/adapters/nostr/nostr-gateway";
import type { DexiePendingOperationRepository } from "@/adapters/storage/dexie/dexie-pending-operation.repository";
import type { DexieTransactionRepository } from "@/adapters/storage/dexie/dexie-transaction.repository";

export function assembleCashuModule(deps: {
  pendingOpRepo: DexiePendingOperationRepository;
  txRepo: DexieTransactionRepository;
  nostrGateway: NostrGatewayAdapter;
  eventBus: EventBus;
}) {
  const { pendingOpRepo, txRepo, nostrGateway, eventBus } = deps;

  // (initialize()는 caller가 seed로 호출)
  const offlineTokenStore = new DexieOfflineTokenStore();
  const cashuBackend = createCashuBackend({
    pendingOpRepo,
    txRepo,
    offlineTokenStore,
    getActiveMintUrls: () => useAppStore.getState().settings.mints,
  });
  const cashuModule = new CashuModule(cashuBackend, nostrGateway, eventBus);
  const modules: WalletModule[] = [cashuModule];

  return { cashuBackend, cashuModule, modules };
}
