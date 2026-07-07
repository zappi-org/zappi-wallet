/**
 * Bootstrap piece — storage/repository assembly.
 *
 * Creates the persistence-layer instances (Dexie repositories, local cache,
 * review queue, etc.). Creation order is preserved.
 */

// ─── Store (composition root only) ───
import { useAppStore } from "@/store";

// ─── Adapters ───
import { DexieTransactionRepository } from "@/adapters/storage/dexie/dexie-transaction.repository";
import { DexieContactRepository } from "@/adapters/storage/dexie/dexie-contact.repository";
import { DexiePendingOperationRepository } from "@/adapters/storage/dexie/dexie-pending-operation.repository";
import { DexieOperationMap } from "@/adapters/storage/dexie/dexie-operation-map";
import { FailedIncomingStoreAdapter } from "@/adapters/storage/failed-incoming-store.adapter";
import { DexieSettingsRepository as SettingsRepository } from "@/adapters/storage/dexie/dexie-settings.repository";
import { DexieProcessedRepository as ProcessedRepository } from "@/adapters/storage/dexie/dexie-processed.repository";
import { DexieReceiveRequestRepository } from "@/adapters/storage/dexie/dexie-receive-request.repository";
import { LocalStorageBalanceCache } from "@/adapters/cache/local-storage-balance-cache.adapter";
import { TrustedMintProviderAdapter } from "@/adapters/runtime/trusted-mint-provider.adapter";
import { DexieIncomingReviewQueue } from "@/adapters/storage/dexie/dexie-incoming-review-queue.store";

export function assembleStorage() {
  const txRepo = new DexieTransactionRepository();
  const contactRepo = new DexieContactRepository();
  const pendingOpRepo = new DexiePendingOperationRepository();
  const operationMap = new DexieOperationMap();
  const failedIncomingStore = new FailedIncomingStoreAdapter();
  const processedStore = new ProcessedRepository();
  const settingsRepo = new SettingsRepository();
  const receiveRequestRepo = new DexieReceiveRequestRepository();
  const balanceCache = new LocalStorageBalanceCache();
  const trustedMintProvider = new TrustedMintProviderAdapter(
    () => useAppStore.getState().settings.mints
  );
  // Untrusted-mint review queue — IndexedDB is the source of truth, Zustand is a UI mirror.
  // This replaces the in-memory queue (which lost entries on refresh), so there's no kill-switch.
  const incomingReviewQueue = new DexieIncomingReviewQueue({
    onEnqueued: (review) => useAppStore.getState().enqueueIncomingReview(review),
    onRemoved: (externalId) =>
      useAppStore.getState().removeIncomingReview(externalId),
  });

  return {
    txRepo,
    contactRepo,
    pendingOpRepo,
    operationMap,
    failedIncomingStore,
    processedStore,
    settingsRepo,
    receiveRequestRepo,
    balanceCache,
    trustedMintProvider,
    incomingReviewQueue,
  };
}
