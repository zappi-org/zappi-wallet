/**
 * Bootstrap 조각 6 — 서비스 층 조립 (bootstrap.ts 순수 이동)
 *
 * 결제/잔액/스왑/연락처/프로필 등 코어 서비스와 RecoveryScheduler,
 * recovery-split 위임 배선(payment.setRecoveryDelegate)까지 원본 순서 그대로.
 */

// ─── Store (composition root만 접근) ───
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

// ─── Coco (composition root만 접근) ───
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

  // 5b. RecoveryScheduler — recoverAll의 행동 단위 분해 (설계 §6.2).
  // 모든 행동은 함수 주입: 서비스는 게이팅·조합만, Coco/모듈 접합은 여기서.
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

  // recoverAll 위임 (ks.recovery-split OFF) — 기존 6개 트리거(unlock/resume/
  // 당김새로고침 등)의 recoverAll이 reconcile+targeted 경로로 바뀐다.
  // 스위치 ON이면 미주입 → 구경로(B1~B9 일괄)로 롤백 (설계 §11.2 4단계).
  //
  // 계수 계약 (4단계 리뷰 #7): recovered에는 구경로와 동일하게 **네트워크 구제
  // 실건수(targeted)만** 계수한다 — 구경로에서 B3 settle 마킹은 recorded,
  // quote 만료는 expired로 recovered/failed 밖이었다. reconcile 정합 수치를
  // 합산하면 "수신자가 내 토큰을 수령"한 것까지 복구 토스트로 표출된다.
  // 예외 격리 (리뷰 #10): 구경로는 어댑터별 try/catch로 절대 reject하지
  // 않았다 — reconcile gate의 실패 쿨다운 재-throw가 targeted까지 삼키지
  // 않도록 단계별로 격리한다.
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
        // 구경로와 동일한 UI 갱신 신호 유지
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
