/**
 * Service-layer assembly: core services (payment/balance/swap/contact/profile),
 * the RecoveryScheduler, and the recovery-split delegate wiring
 * (payment.setRecoveryDelegate).
 */

// ─── Store (composition root access only) ───
import { useAppStore } from "@/store";

// ─── Composition Roots ───
import { createPaymentService } from "./payment";
import { createBalanceService } from "./balance";
import { createSwapService } from "./swap";
import { createContactService } from "./contact";
import { createProfileService } from "./profile";
import { createInputRouter } from "./input-router";
import { createAddressResolver } from "./address-resolver";
import { TokenReceiverAdapter } from "./token-receiver.adapter";
import { resolveIncomingReview } from "./incoming-review";

import { ReceiveRequestFacadeService } from "@/core/services/receive-request-facade.service";
import { RecoverySchedulerService } from "@/core/services/recovery-scheduler.service";

// ─── Coco (composition root access only) ───
import {
  getMintOpStateLocal,
  getSendRecoveryOps,
  reconcileCashu,
  recoverLegacySendTokens,
  requeuePaidMintQuotesInCoco,
  runCocoRecoverySweeps,
} from "@/modules/cashu";

import type { WalletModule } from "@/core/ports/driven/wallet-module.port";
import type { EventBus } from "@/core/events/event-bus";
import type { KillSwitches } from "@/core/utils/kill-switch";
import type { CashuModuleBackend } from "@/modules/cashu/cashu.module";
import type { NostrGatewayAdapter } from "@/adapters/nostr/nostr-gateway";
import type { DirectLnurlAdapter } from "@/adapters/lnurl/direct-lnurl.adapter";
import type { Nip05ResolverAdapter } from "@/adapters/nip05/nip05-resolver";
import type { DexieTransactionRepository } from "@/adapters/storage/dexie/dexie-transaction.repository";
import type { DexieContactRepository } from "@/adapters/storage/dexie/dexie-contact.repository";
import type { DexiePendingOperationRepository } from "@/adapters/storage/dexie/dexie-pending-operation.repository";
import type { DexieOperationMap } from "@/adapters/storage/dexie/dexie-operation-map";
import type { DexieProcessedRepository } from "@/adapters/storage/dexie/dexie-processed.repository";
import type { DexieSettingsRepository } from "@/adapters/storage/dexie/dexie-settings.repository";
import type { DexieReceiveRequestRepository } from "@/adapters/storage/dexie/dexie-receive-request.repository";
import type { DexieIncomingReviewQueue } from "@/adapters/storage/dexie/dexie-incoming-review-queue.store";
import type { TransferLifecycleService } from "@/core/services/transfer-lifecycle.service";

export function assembleCoreServices(deps: {
  modules: WalletModule[];
  txRepo: DexieTransactionRepository;
  contactRepo: DexieContactRepository;
  pendingOpRepo: DexiePendingOperationRepository;
  operationMap: DexieOperationMap;
  processedStore: DexieProcessedRepository;
  settingsRepo: DexieSettingsRepository;
  receiveRequestRepo: DexieReceiveRequestRepository;
  incomingReviewQueue: DexieIncomingReviewQueue;
  eventBus: EventBus;
  killSwitches: KillSwitches;
  cashuBackend: CashuModuleBackend;
  nostrGateway: NostrGatewayAdapter;
  lnurlAdapter: DirectLnurlAdapter;
  nip05Adapter: Nip05ResolverAdapter;
  transferLifecycle: TransferLifecycleService;
}) {
  const {
    modules,
    txRepo,
    contactRepo,
    pendingOpRepo,
    operationMap,
    processedStore,
    settingsRepo,
    receiveRequestRepo,
    incomingReviewQueue,
    eventBus,
    killSwitches,
    cashuBackend,
    nostrGateway,
    lnurlAdapter,
    nip05Adapter,
    transferLifecycle,
  } = deps;

  const payment = createPaymentService(
    modules,
    txRepo,
    eventBus,
    operationMap,
    transferLifecycle
  );
  const tokenReceiver = new TokenReceiverAdapter(payment);
  const balance = createBalanceService(modules);
  const swap = createSwapService(modules, txRepo, eventBus);
  const contact = createContactService(contactRepo);
  const profile = createProfileService(nostrGateway, settingsRepo);
  const inputRouter = createInputRouter(lnurlAdapter);
  const addressResolver = createAddressResolver(
    nip05Adapter,
    nostrGateway,
    lnurlAdapter
  );
  const receiveRequest = new ReceiveRequestFacadeService(receiveRequestRepo);

  // RecoveryScheduler — decomposes recoverAll into per-behavior actions. Every
  // action is function-injected: the service only gates and composes; the
  // Coco/module wiring lives here.
  const recoveryScheduler = new RecoverySchedulerService({
    reconcileCashu: async () =>
      reconcileCashu({
        pendingOpRepo,
        txRepo,
        activeMintUrls: useAppStore.getState().settings.mints,
        sendOps: await getSendRecoveryOps(),
        mintOpLookup: getMintOpStateLocal,
      }),
    requeuePaidQuotes: requeuePaidMintQuotesInCoco,
    redeemOfflineTokens: () => cashuBackend.redeemPendingReceivedTokens(),
    recoverLegacySends: async () => {
      const all = await pendingOpRepo.list();
      const legacy = all.filter(
        (op) => op.kind === "send-token" && !op.metadata?.operationId
      );
      if (legacy.length === 0) return { reclaimed: 0, recorded: 0 };
      return recoverLegacySendTokens(
        {
          pendingOpRepo,
          txRepo,
          receiveToken: (token) => cashuBackend.receiveToken(token),
        },
        legacy
      );
    },
    runCocoSweeps: runCocoRecoverySweeps,
    reviewQueue: incomingReviewQueue,
    redeemToken: (input) => payment.redeem({ input }),
    resolveReview: (review) =>
      resolveIncomingReview(
        {
          processedStore,
          receiveRequest,
          removeIncomingReview: (id) => incomingReviewQueue.remove(id),
          nostrGateway,
          posDevices: useAppStore.getState().settings.posDevices,
        },
        { review }
      ),
    discardReview: async (review, reason) => {
      await processedStore.save({
        externalId: review.externalId,
        processedAt: Date.now(),
        result: "skipped",
        error: reason,
      });
      await incomingReviewQueue.remove(review.externalId);
    },
  });

  // recoverAll delegate (ks.recovery-split OFF) — recoverAll from the existing 6
  // triggers (unlock/resume/pull-to-refresh, etc.) switches to the
  // reconcile+targeted path. With the switch ON we don't inject, rolling back to
  // the old path (everything in one batch).
  //
  // Count contract: like the old path, recovered counts only real network
  // rescues (targeted) — in the old path a settle mark was recorded and quote
  // expiry was expired, both outside recovered/failed. Summing reconcile's
  // reconciliation figures would surface even "the recipient received my token"
  // as a recovery toast.
  // Exception isolation: the old path never rejected (per-adapter try/catch) —
  // isolate per step so the reconcile gate's failure-cooldown re-throw doesn't
  // swallow targeted.
  if (!killSwitches["recovery-split"]) {
    payment.setRecoveryDelegate(async (opts) => {
      try {
        const rec = await recoveryScheduler.reconcile();
        console.log(
          `[Recovery] reconcile: settled=${rec.settled} reclaimed=${rec.reclaimed} failed=${rec.failed} cleaned=${rec.cleaned}`
        );
      } catch (e) {
        console.warn("[Recovery] reconcile failed:", e);
      }
      try {
        const report = await recoveryScheduler.recoverTargeted({
          bypassGate: opts?.bypassGate,
        });
        // Keep the same UI-refresh signal as the old path
        if (report.recovered > 0) {
          eventBus.emit({ type: "recovery:completed", payload: report });
        }
        return [report];
      } catch (e) {
        console.warn("[Recovery] targeted failed:", e);
        return [{ moduleId: "cashu", recovered: 0, failed: 1 }];
      }
    });
  }

  return {
    payment,
    tokenReceiver,
    balance,
    swap,
    contact,
    profile,
    inputRouter,
    addressResolver,
    receiveRequest,
    recoveryScheduler,
  };
}
