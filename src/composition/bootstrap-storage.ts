/**
 * Bootstrap 조각 1 — 스토리지/레포지토리 조립 (bootstrap.ts 순수 이동)
 *
 * Dexie 레포지토리·로컬 캐시·리뷰 대기열 등 영속 계층 인스턴스를 생성한다.
 * 생성 순서는 원본 bootstrap.ts "1. Infrastructure" 절과 동일하게 보존.
 */

// ─── Store (composition root만 접근) ───
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
  // 미신뢰 민트 review 대기열 — IndexedDB 원천, Zustand는 UI 미러 (설계 §6.2).
  // 메모리 큐의 새로고침 유실(리뷰 #3 blocker)을 닫는 교체라 kill-switch 없음.
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
