/**
 * Bootstrap fragment — incoming pipeline assembly (verbatim move from bootstrap.ts).
 *
 * Shared dedup store, Nostr incoming watcher, and the recovery/incomingPayment/
 * pendingItems services. recoveryStoreAdapter is created and shared inside this
 * fragment because recovery and the watcher must see the same instance.
 */

// ─── Store (composition root only) ───
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

  // Shared dedup store (recovery + watcher watch the same store to avoid double processing)
  const recoveryStoreAdapter = new RecoveryStoreAdapter();

  // Nostr Incoming Watcher (Adapter Layer — discovery only; TLS owns management)
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
    // Persistent relay set for the all-EOSE check (no connection snapshot)
    () => useAppStore.getState().settings.relays
  );

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
