/**
 * Bootstrap 조각 9 — 수신 파이프라인 조립 (bootstrap.ts 순수 이동)
 *
 * 공유 dedup store, Nostr incoming watcher, recovery/incomingPayment/
 * pendingItems 서비스. recoveryStoreAdapter는 recovery와 watcher가 같은
 * 인스턴스를 봐야 하므로 이 조각 내부에서 생성·공유한다.
 */

// ─── Store (composition root만 접근) ───
import { useAppStore } from "@/store";

import { RecoveryStoreAdapter } from "@/adapters/storage/recovery-store.adapter";

// ─── Nostr Watcher (Adapter Layer) ───
import { NostrIncomingWatcher } from "@/adapters/nostr/nostr-incoming-watcher";

// ─── Composition Roots ───
import { createRecoveryService } from "./recovery";
import { createPendingItemsService } from "./pending-items";
import { IncomingPaymentService } from "@/core/services/incoming-payment.service";

import type { WalletModule } from "@/core/ports/driven/wallet-module.port";
import type { EventBus } from "@/core/events/event-bus";
import type { NostrGatewayAdapter } from "@/adapters/nostr/nostr-gateway";
import type { DexiePendingTransferStore } from "@/adapters/storage/dexie/dexie-pending-transfer-store";
import type { DexieProcessedRepository } from "@/adapters/storage/dexie/dexie-processed.repository";
import type { TrustedMintProviderAdapter } from "@/adapters/runtime/trusted-mint-provider.adapter";
import type { DexieIncomingReviewQueue } from "@/adapters/storage/dexie/dexie-incoming-review-queue.store";
import type { TokenCodecAdapter } from "@/adapters/codec/token-codec.adapter";
import type { DexieGiftwrapCursorStore } from "@/adapters/storage/dexie/dexie-giftwrap-cursor.store";
import type { FailedIncomingStoreAdapter } from "@/adapters/storage/failed-incoming-store.adapter";
import type { DexieTransactionRepository } from "@/adapters/storage/dexie/dexie-transaction.repository";
import type { DexieReceiveRequestRepository } from "@/adapters/storage/dexie/dexie-receive-request.repository";
import type { PaymentService } from "@/core/services/payment.service";
import type { ReceiveRequestFacadeService } from "@/core/services/receive-request-facade.service";

export function assembleIncomingPipeline(deps: {
  nostrGateway: NostrGatewayAdapter;
  pendingTransferStore: DexiePendingTransferStore;
  eventBus: EventBus;
  processedStore: DexieProcessedRepository;
  trustedMintProvider: TrustedMintProviderAdapter;
  incomingReviewQueue: DexieIncomingReviewQueue;
  tokenCodec: TokenCodecAdapter;
  payment: PaymentService;
  receiveRequest: ReceiveRequestFacadeService;
  txRepo: DexieTransactionRepository;
  receiveRequestRepo: DexieReceiveRequestRepository;
  failedIncomingStore: FailedIncomingStoreAdapter;
  giftwrapCursorStore: DexieGiftwrapCursorStore | undefined;
  modules: WalletModule[];
}) {
  const {
    nostrGateway,
    pendingTransferStore,
    eventBus,
    processedStore,
    trustedMintProvider,
    incomingReviewQueue,
    tokenCodec,
    payment,
    receiveRequest,
    txRepo,
    receiveRequestRepo,
    failedIncomingStore,
    giftwrapCursorStore,
    modules,
  } = deps;

  // 9. Shared dedup store (recovery + watcher가 같은 store를 보고 중복 처리 방지)
  const recoveryStoreAdapter = new RecoveryStoreAdapter();

  // 10. Nostr Incoming Watcher (Adapter Layer — 발견만 담당, 관리는 TLS)
  const nostrIncomingWatcher = new NostrIncomingWatcher(
    nostrGateway,
    pendingTransferStore,
    eventBus,
    processedStore,
    recoveryStoreAdapter,
    trustedMintProvider,
    incomingReviewQueue,
    tokenCodec,
    () => useAppStore.getState().pendingEcashRequestId,
    // 全EOSE 판정용 persistent relay 집합 (리뷰 #2 — 연결 스냅샷 금지)
    () => useAppStore.getState().settings.relays
  );

  // 11. Additional services
  const recovery = createRecoveryService(
    nostrGateway,
    payment,
    trustedMintProvider,
    incomingReviewQueue,
    receiveRequest,
    recoveryStoreAdapter,
    processedStore,
    txRepo,
    giftwrapCursorStore
  );
  const incomingPayment = new IncomingPaymentService(
    payment,
    processedStore,
    failedIncomingStore,
    receiveRequest,
    txRepo,
    eventBus
  );
  const pendingItems = createPendingItemsService(
    txRepo,
    receiveRequestRepo,
    modules
  );

  return { nostrIncomingWatcher, recovery, incomingPayment, pendingItems };
}
