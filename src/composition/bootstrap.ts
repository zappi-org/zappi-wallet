/**
 * Bootstrap — Composition Root (유일한 경계 횡단 지점)
 *
 * 이 파일만 modules/, adapters/, core/services/ 전부 import 가능.
 * 모든 어댑터를 생성하고, 서비스를 조립하여 ServiceRegistry를 반환.
 *
 * 호출 시점: MainApp.tsx에서 unlock 이후 (seed + nostrPrivkey 필요)
 */

// ─── Core ───
import { createEventBus } from "@/core/events/event-bus";
import { toNumber } from "@/core/domain/amount";

// ─── Store (composition root만 접근) ───
import { useAppStore } from "@/store";

// ─── Modules (bootstrap만 import 허용) ───
import { CashuModule } from "@/modules/cashu/cashu.module";
import { createCashuBackend } from "@/modules/cashu/create-cashu-backend";

// ─── Adapters ───
import { DexieTransactionRepository } from "@/adapters/storage/dexie/dexie-transaction.repository";
import { DexieContactRepository } from "@/adapters/storage/dexie/dexie-contact.repository";
import { DexiePendingOperationRepository } from "@/adapters/storage/dexie/dexie-pending-operation.repository";
import { DexieOperationMap } from "@/adapters/storage/dexie/dexie-operation-map";
import { DexieOfflineTokenStore } from "@/adapters/storage/dexie/dexie-offline-token-store";
import { NostrGatewayAdapter } from "@/adapters/nostr/nostr-gateway";
import { NostrPaymentTransport } from "@/adapters/nostr/nostr-payment-transport";
import { NostrExternalMnemonicMintDiscoveryAdapter } from "@/adapters/nostr/external-mnemonic-mint-discovery.adapter";
import { derivePublicKey } from "@/adapters/nostr/internal/nostr-crypto";
import { FailedIncomingStoreAdapter } from "@/adapters/storage/failed-incoming-store.adapter";
import { CocoP2PKKeyManager } from "@/adapters/crypto/p2pk-key-manager.adapter";
import { KeyManagerAdapter } from "@/adapters/crypto/key-manager.adapter";

// ─── Adapters (non-module) ───
import { DirectLnurlAdapter } from "@/adapters/lnurl/direct-lnurl.adapter";
import { Nip05ResolverAdapter } from "@/adapters/nip05/nip05-resolver";
import { DexieSettingsRepository as SettingsRepository } from "@/adapters/storage/dexie/dexie-settings.repository";
import { DexieProcessedRepository as ProcessedRepository } from "@/adapters/storage/dexie/dexie-processed.repository";
import { RecoveryStoreAdapter } from "@/adapters/storage/recovery-store.adapter";

// ─── Legacy services (composition root만 wrap 가능) ───
import { exchangeRateService } from "./exchange-rate";

// ─── Coco (composition root만 접근) ───
import {
  addMint as trustMintInCoco,
  createExternalMnemonicRecovery,
  decodeTokenForPaymentPayload,
  getMintInfoFromCoco,
  getMintOpStateLocal,
  getSendRecoveryOps,
  markQuoteAsSwap,
  reconcileCashu,
  recoverLegacySendTokens,
  removeMintFromCoco,
  requeuePaidMintQuotesInCoco,
  runCocoRecoverySweeps,
  unmarkQuoteAsSwap,
} from "@/modules/cashu";
import { RecoverySchedulerService } from "@/core/services/recovery-scheduler.service";
import { resolveIncomingReview } from "./incoming-review";
import { clearMintData } from "@/adapters/storage/dexie/schema";
import { LocalStorageBalanceCache } from "@/adapters/cache/local-storage-balance-cache.adapter";

// ─── Phase 6: New Adapters ───
import { CryptoGatewayAdapter } from "@/adapters/crypto/crypto-gateway.adapter";
import { TokenCodecAdapter } from "@/adapters/codec/token-codec.adapter";
import { CashuFeeEstimatorAdapter } from "@/modules/cashu/adapters/cashu-fee-estimator.adapter";
import { CashuRoutePaymentOperatorAdapter } from "@/modules/cashu/adapters/cashu-route-payment-operator.adapter";
import { CashuSendTokenOperatorAdapter } from "@/modules/cashu/adapters/cashu-send-token-operator.adapter";
import { MintHealthCheckerAdapter } from "@/adapters/health/mint-health-checker.adapter";
import { MintMetadataStoreAdapter } from "@/adapters/metadata/mint-metadata-store.adapter";
import { TrustedMintProviderAdapter } from "@/adapters/runtime/trusted-mint-provider.adapter";
import { DexieIncomingReviewQueue } from "@/adapters/storage/dexie/dexie-incoming-review-queue.store";
import { CrossTabSyncNotifierAdapter } from "@/adapters/runtime/cross-tab-sync-notifier.adapter";
import { broadcastSync, getBroadcastChannel } from "@/utils/cross-tab-sync";
import { isSameMintUrl } from "@/utils/url";
import { DexieRouteExecutionStore } from "@/adapters/storage/dexie/dexie-route-execution-store";
import { SettingsTrustedAccountStoreAdapter } from "@/adapters/runtime/settings-trusted-account-store.adapter";

// ─── Phase 6: New Core Services ───
import { CryptoService } from "@/core/services/crypto.service";
import { InputParserService } from "@/core/services/input-parser.service";
import { RoutingService } from "@/core/services/routing.service";
import { MintMetadataFacadeService } from "@/core/services/mint-metadata-facade.service";
import { MintHealthFacadeService } from "@/core/services/mint-health-facade.service";
import { TransactionMgmtService } from "@/core/services/transaction-mgmt.service";
import { ReceiveRequestFacadeService } from "@/core/services/receive-request-facade.service";
import { ReclaimService } from "@/core/services/reclaim.service";
import { PaymentRequestService } from "@/core/services/payment-request.service";
import { UsernameService } from "@/core/services/username.service";
import { TrustRegistryService } from "@/core/services/trust-registry.service";
import { NostrDirectPaymentService } from "@/core/services/nostr-direct-payment.service";
import { RouteExecutionService } from "@/core/services/route-execution.service";
import { ExternalWalletRecoveryService } from "@/core/services/external-wallet-recovery.service";
import { TransferLifecycleService } from "@/core/services/transfer-lifecycle.service";
import { DexiePendingTransferStore } from "@/adapters/storage/dexie/dexie-pending-transfer-store";

// ─── Cashu Adapters (TransferOperator 구현체) ───
import { CashuBolt11Adapter } from "@/modules/cashu/adapters/cashu-bolt11.adapter";
import { CashuEcashAdapter } from "@/modules/cashu/adapters/cashu-ecash.adapter";

// ─── Phase 6: Metadata + NUT-18 HTTP ───
import { MintMetadataService, metadataEvents } from "@/modules/cashu/metadata";
import { MintInfoService } from "@/modules/cashu/mint-info.service";
import {
  enableCashuWatchers,
  getCashuKeyring,
  getCashuRuntimeManager,
  pauseCashuSubscriptions,
  recheckCashuPendingMintQuotes,
  resumeCashuSubscriptions,
} from "@/modules/cashu/cashu-runtime";
import { DexieMintMetadataRepository } from "@/adapters/storage/dexie/dexie-mint-metadata.repository";
import { createNut18HttpPollerFactory } from "./nut18-poller-factory";
import {
  flushNetCounters,
  incrementNetCounter,
  startNetCounterFlusher,
} from "@/adapters/telemetry/net-counters";
import { readKillSwitches } from "@/core/utils/kill-switch";
import { DexieGiftwrapCursorStore } from "@/adapters/storage/dexie/dexie-giftwrap-cursor.store";
import { ZappiLinkAdapter } from "@/adapters/zappi-link/zappi-link.adapter";
import { finalizeEvent } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";
import { DEFAULT_RELAYS, NOSTR_KINDS, STORAGE_KEYS } from "@/core/constants";
import { DexieReceiveRequestRepository } from "@/adapters/storage/dexie/dexie-receive-request.repository";

// ─── Nostr Watcher (Adapter Layer) ───
import { NostrIncomingWatcher } from "@/adapters/nostr/nostr-incoming-watcher";

// ─── Composition Roots ───
import { createPaymentService } from "./payment";
import { createBalanceService } from "./balance";
import { createSwapService } from "./swap";
import { createContactService } from "./contact";
import { createInputRouter } from "./input-router";
import { createAddressResolver } from "./address-resolver";
import { createProfileService } from "./profile";
import { createRecoveryService } from "./recovery";
import { createSupportService } from "./support";
import { IncomingPaymentService } from "@/core/services/incoming-payment.service";
import { createPendingItemsService } from "./pending-items";
import { connectEventStoreBridge } from "./event-store-bridge";
import { connectTransferTxBridge } from "./transfer-tx-bridge";
import { connectCocoEventBridge } from "./coco-event-bridge";
import { connectGiftWrapSettlementBridge } from "./gift-wrap-settlement.bridge";
import { removeMintArtifacts } from "./remove-mint";
import { PaymentDelivery } from "./payment-delivery";
import { PaymentRecoveredTokenReceiver } from "./recovered-token-receiver";
import { TokenReceiverAdapter } from "./token-receiver.adapter";

// ─── Types ───
import type { WalletModule } from "@/core/ports/driven/wallet-module.port";
import type { OperationMap } from "@/core/ports/driven/operation-map.port";
import type { ServiceRegistry } from "@/core/ports/driving/service-registry";
import type { MintInfoUseCase } from "@/core/ports/driving/mint-info.usecase";
import type { MintInfoData } from "@/core/types";
import type {
  TransferOperator,
  MessageTransport,
} from "@/core/ports/driven/transfer-operator.port";

// ─── Routing types (Phase 6에서 SendFlow 전환 시 제거) ───
export type {
  RouteSelection,
  RouteContext,
  RouteExecutionResult,
} from "@/core/domain/routing";
import type {
  RouteSelection,
  RouteContext,
  RouteExecutionResult,
} from "@/core/domain/routing";
import type { Result } from "@/core/types/result";
import type { BaseError } from "@/core/errors";

export type RouteResult = Result<RouteExecutionResult, BaseError>;

// ─── Bootstrap Input ───

export interface BootstrapDeps {
  /** Nostr 개인키 (hex) — unlock 후 사용 가능 */
  nostrPrivateKeyHex: string;
  /** BIP-39 seed — support 전용 파생키 생성에만 사용하고 저장하지 않음 */
  bip39Seed: Uint8Array;
}

export interface BootstrapResult extends ServiceRegistry {
  // ─── Module instances ───
  readonly cashuModule: CashuModule;
  readonly operationMap: OperationMap;

  // ─── Lifecycle (MainApp만 호출) ───
  activate(): Promise<void>;
  onResume(): Promise<void>;
  onPause(): Promise<void>;
  /** 레지스트리 교체·폐기 시 타이머/구독 정리 (flusher·TLS폴링·watcher·gateway) */
  dispose(): void;
  disconnectBridge(): void;
  disconnectGiftWrapSettlement(): void;

  // ─── Balance refresh (store 갱신 포함, composition root 와이어링) ───
  refreshBalance(): Promise<void>;

  // ─── Cleanup ───
  // 로그아웃 소거는 composition/logout.ts(wipeAccountData)가 전담한다 —
  // 조각별 삭제(deleteCocoData/deleteAllContacts/clearRecoverySyncState 등)는
  // 전 테이블 clear + DB delete + localStorage 정책으로 승계됨 (감사 Phase 1).
  readonly cleanup: {
    /** 민트 1곳 제거 시 관련 아티팩트 정리 (remove-mint 플로우 전용) */
    clearMintData(mintUrl: string): Promise<void>;
  };

  // ─── Exchange rate ───
  readonly exchangeRate: {
    loadCachedRates(): Promise<void>;
    fetchRates(): void;
    refreshIfStale(): Promise<void>;
  };

  // ─── Routing (Phase 6에서 제거) ───
  executeRoute(
    selection: RouteSelection,
    context: RouteContext
  ): Promise<RouteResult>;

  // ─── Nostr incoming watcher ───
  readonly nostrIncomingWatcher: NostrIncomingWatcher;

  // ─── P2PK, offline token ───
  readonly p2pkKeyManager: { getCurrentKey(): Promise<{ pubkey: string }> };
  storeOfflineToken(
    token: string,
    amount: number,
    mintUrl: string,
    dleqStatus: "valid" | "missing"
  ): Promise<string>;
  trustMint(mintUrl: string): Promise<void>;
}

// ─── Bootstrap ───

export function createBootstrap(deps: BootstrapDeps): BootstrapResult {
  // 1. Infrastructure
  const eventBus = createEventBus();
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

  // 2. Nostr Gateway
  // kill-switch 스냅샷 — bootstrap 1회 읽기로 조립 분기 (설계 §11.1)
  const killSwitches = readKillSwitches();
  // ks.cursor ON이면 store 미주입 → cursor 스펙이 무시되어 구동작(전체 replay)
  const giftwrapCursorStore = killSwitches.cursor
    ? undefined
    : new DexieGiftwrapCursorStore();
  const nostrGateway = new NostrGatewayAdapter({
    privateKeyHex: deps.nostrPrivateKeyHex,
    cursorStore: giftwrapCursorStore,
    // 6단계 (설계 §9/§10): SessionController 위임 — 연결/구독 레지스트리,
    // attach 보장, session lease, per-relay 캐치업. ON이면 레거시 경로 전체.
    useSessionController: !killSwitches["nostr-controller"],
  });

  // 3. Cashu Module (initialize()는 caller가 seed로 호출)
  const offlineTokenStore = new DexieOfflineTokenStore();
  const cashuBackend = createCashuBackend({
    pendingOpRepo,
    txRepo,
    offlineTokenStore,
    getActiveMintUrls: () => useAppStore.getState().settings.mints,
  });
  const cashuModule = new CashuModule(cashuBackend, nostrGateway, eventBus);
  const modules: WalletModule[] = [cashuModule];

  // 4. Non-module adapters
  const lnurlAdapter = new DirectLnurlAdapter();
  const nip05Adapter = new Nip05ResolverAdapter();
  const outgoingTransport = new NostrPaymentTransport(
    nostrGateway,
    decodeTokenForPaymentPayload,
  );
  const externalMnemonicRecovery = createExternalMnemonicRecovery();
  const externalMnemonicMintDiscovery =
    new NostrExternalMnemonicMintDiscoveryAdapter(
      nostrGateway,
      new KeyManagerAdapter(),
      {
        getDiscoveryRelays: () => [
          ...DEFAULT_RELAYS,
          ...(useAppStore.getState().settings.relays || []),
        ],
      }
    );

  // 5. TransferLifecycleService (Sprint 3 — dual-run with existing services)
  const pendingTransferStore = new DexiePendingTransferStore();

  // MessageTransport adapter wrapping NostrPaymentTransport
  const messageTransport: MessageTransport = {
    async publish(params: {
      recipient: string;
      content: string;
      memo?: string;
    }) {
      const result = await outgoingTransport.send({
        recipientPubkey: params.recipient,
        token: params.content,
        memo: params.memo,
      });
      return { deliveryId: result.success ? "nostr-sent" : "" };
    },
  };

  const tokenCodec = new TokenCodecAdapter();

  const cashuBolt11Adapter = new CashuBolt11Adapter(cashuBackend);
  const cashuEcashAdapter = new CashuEcashAdapter(
    cashuBackend,
    messageTransport,
    tokenCodec,
    eventBus
  );

  const operators = new Map<string, TransferOperator>([
    ["bolt11", cashuBolt11Adapter],
    ["ecash", cashuEcashAdapter],
  ]);

  const transferLifecycle = new TransferLifecycleService(
    pendingTransferStore,
    operators,
    eventBus,
    operationMap,
    // §12 카운터 — core가 telemetry를 직접 import하지 않도록 경계에서 주입
    {
      stuckDetected: () => incrementNetCounter("tls_stuck_detected"),
      stuckConfirmedSettled: () =>
        incrementNetCounter("tls_stuck_confirmed_settled"),
    }
  );

  const disconnectGiftWrapSettlement = connectGiftWrapSettlementBridge(
    eventBus,
    transferLifecycle,
    {
      nostrGateway,
      getPosDevices: () => useAppStore.getState().settings.posDevices,
    }
  );

  // 5. Services (via composition roots)
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

  // 6. P2PK key manager
  const p2pkKeyManager = new CocoP2PKKeyManager(getCashuKeyring);

  // 7. Cold start cache → store 즉시 반영 (동기)
  const cached = balanceCache.load();
  if (cached) {
    const byMint: Record<string, number> = {};
    let total = 0;
    for (const mb of cached) {
      for (const account of mb.accounts) {
        byMint[account.id] = toNumber(account.amount);
        total += toNumber(account.amount);
      }
    }
    useAppStore.getState().setBalance({ total, byMint });
  }

  // 8. EventBus → Store bridge
  const balanceRefresh = async () => {
    const moduleBalances = await balance.getByModule();
    const byMint: Record<string, number> = {};
    let total = 0;
    for (const mb of moduleBalances) {
      for (const account of mb.accounts) {
        byMint[account.id] = toNumber(account.amount);
        total += toNumber(account.amount);
      }
    }
    useAppStore.getState().setBalance({ total, byMint });
    balanceCache.save(moduleBalances);
  };
  const disconnectBridge = connectEventStoreBridge(eventBus, {
    handleBalance: true,
    balanceRefresh,
    receiveRequest,
  });

  // Transfer → Transaction Bridge (TLS 경로의 거래내역 저장)
  connectTransferTxBridge({
    eventBus,
    txRepo,
    triggerTxRefresh: () => useAppStore.getState().triggerTxRefresh(),
  });

  // 8. Lifecycle: activate (Coco init + observers + watchers + bridge)
  let netCounterFlusherStop: (() => void) | null = null;
  let mintReconnectStop: (() => void) | null = null;

  // 생존 heartbeat (설계 §6.3 resume / [F12]): 모바일 freeze/kill은
  // visibilitychange:hidden을 못 남기므로, 포그라운드 동안 60초마다 기록한
  // lastAliveAt으로 "얼마나 오래 떠나 있었나"를 판정한다. 기록 부재·손상 시
  // 5분 초과로 간주(보수적 = 전수 재확인).
  // 키는 STORAGE_KEYS 로 단일화 — 로그아웃(wipeAccountData)의 소거 대상과
  // 기록자가 같은 상수를 봐야 드리프트가 불가능하다 (Phase 1 리뷰 M-1)
  const LAST_ALIVE_KEY = STORAGE_KEYS.LAST_ALIVE;
  const RESUME_RECHECK_THRESHOLD_MS = 5 * 60 * 1000;
  const markAlive = () => {
    try {
      localStorage.setItem(LAST_ALIVE_KEY, String(Date.now()));
    } catch {
      /* storage 불가 — awayLongEnough가 true로 폴백 */
    }
  };
  const awayLongEnough = (): boolean => {
    try {
      const raw = localStorage.getItem(LAST_ALIVE_KEY);
      const at = raw ? Number(raw) : NaN;
      if (!Number.isFinite(at) || at <= 0) return true;
      return Date.now() - at > RESUME_RECHECK_THRESHOLD_MS;
    } catch {
      return true;
    }
  };
  // "포그라운드 생존"만 측정한다 — pause 중에도 interval이 돌면 hidden 탭의
  // 스로틀된 tick이 lastAliveAt을 계속 갱신해, 장시간 백그라운드 복귀가
  // "짧은 부재"로 오판된다 (4단계 리뷰 #5). pause에서 정지, resume에서 재개.
  let aliveHeartbeatStop: (() => void) | null = null;
  const startAliveHeartbeat = () => {
    if (aliveHeartbeatStop) return;
    markAlive();
    const timer = setInterval(markAlive, 60_000);
    aliveHeartbeatStop = () => clearInterval(timer);
  };
  const stopAliveHeartbeat = () => {
    if (aliveHeartbeatStop) {
      aliveHeartbeatStop();
      aliveHeartbeatStop = null;
    }
  };
  // pause-during-activate 레이스 가드 (코드리뷰 #6): activate의 startPolling이
  // 이미 백그라운드로 간 앱에서 타이머를 켜는 것을 방지.
  let paused = false;

  // TLS 감시 모드 (설계 §7.2/§11.2 5단계): ks.tls-sweep ON이면 구경로(30s 일괄
  // 폴링 — 전송당 원격 왕복), OFF면 120s stuck-sweep(로컬 1차 + stuck에 한해
  // §7.3 매트릭스 원격 확인 1회). 두 stop을 모두 부르는 이유: 스위치 토글 후
  // 재unlock 시 이전 모드의 타이머가 세대를 넘지 않게.
  const startTransferMonitor = () => {
    if (killSwitches["tls-sweep"]) {
      transferLifecycle.startPolling(30000);
    } else {
      transferLifecycle.startStuckSweep(120_000);
    }
  };
  const stopTransferMonitor = () => {
    transferLifecycle.stopPolling();
    transferLifecycle.stopStuckSweep();
  };

  // 크로스탭 sweep 재개 배선 (§7.2 [F20-잔여]): pending-0으로 정지한 탭이
  // 타 탭 발생 transfer를 놓치지 않게. watcher 생성 경로(incoming:received)는
  // TLS를 거치지 않으므로 로컬 ensure도 여기서 건다.
  let transferSweepWiringStop: (() => void) | null = null;
  const wireTransferSweepSignals = () => {
    if (transferSweepWiringStop) return;
    const unsubs: Array<() => void> = [];
    unsubs.push(
      eventBus.on("transfer:submitted", () => {
        broadcastSync("transfer_created");
      })
    );
    unsubs.push(
      eventBus.on("incoming:received", () => {
        transferLifecycle.ensureSweepScheduled();
        broadcastSync("transfer_created");
      })
    );
    const channel = getBroadcastChannel();
    if (channel) {
      const onMessage = (event: MessageEvent) => {
        if ((event.data as { type?: string })?.type === "transfer_created") {
          transferLifecycle.ensureSweepScheduled();
        }
      };
      channel.addEventListener("message", onMessage);
      unsubs.push(() => channel.removeEventListener("message", onMessage));
    }
    transferSweepWiringStop = () => {
      unsubs.forEach((u) => u());
      transferSweepWiringStop = null;
    };
  };
  const activate = async () => {
    const manager = await getCashuRuntimeManager();

    // 프로덕션 집계 카운터 flush 주기 시작 (설계 §12) — 재호출에도 1회만
    if (!netCounterFlusherStop) {
      netCounterFlusherStop = startNetCounterFlusher();
    }

    // 생존 heartbeat 시작 — resume recheck 판정의 원천 (설계 [F12])
    startAliveHeartbeat();

    // persistent relay 집합 확립 (설계 §10 B3: DEFAULT_RELAYS + settings.relays —
    // 6단계 리뷰 #1 blocker): 레거시 경로는 fetchGiftWraps/sendDM 내부의
    // connect(params.relays) 부수효과가 연결을 암묵 확립했지만, 컨트롤러 경로는
    // 그 라인에 도달하지 않는다 — 여기서 명시 확립한다. fire-and-forget이어도
    // 안전한 이유: 구독 attach 보장이 "등록 후 연결되는 relay"에 자동으로 붙는다.
    // 레거시 경로(ks ON)에도 같은 호출이 무해하다(기존 암묵 connect의 조기 실행).
    nostrGateway
      .connect([
        ...new Set([...DEFAULT_RELAYS, ...useAppStore.getState().settings.relays]),
      ])
      .catch((e) => console.warn("[Bootstrap] relay connect failed:", e));

    // review 대기열 부팅 hydrate (설계 §6.2) — 이전 세션의 미해소 review를
    // Zustand 미러로 복원해 확인 모달이 다시 뜨게 한다. store enqueue는
    // externalId 멱등이라 watcher 재수신과 겹쳐도 무해.
    incomingReviewQueue
      .listAll()
      .then((reviews) => {
        const { enqueueIncomingReview } = useAppStore.getState();
        reviews.forEach(enqueueIncomingReview);
      })
      .catch((e) => console.error("[Bootstrap] review hydrate failed:", e));

    // 재연결 시 health 갱신의 단일 소유 (설계 §5 — 기존에는 use-mint-health 훅
    // 인스턴스(3곳 마운트)마다 각자 reconnect effect를 등록했다). 스위치와 무관하게
    // mintHealth 경유라 legacy 경로에서도 동작한다.
    if (!mintReconnectStop && typeof window !== "undefined") {
      const handleOnline = () => {
        mintHealth
          .checkAllMints(useAppStore.getState().settings.mints)
          .then((statuses) => {
            // 훅 effect 시절의 store 동기화 보존 (구현 리뷰 #3) — mints[].isOnline
            const updateMintStatus = useAppStore.getState().updateMintStatus;
            statuses.forEach((s) => updateMintStatus(s.url, s.isOnline));
          })
          .catch(() => {});
      };
      window.addEventListener("online", handleOnline);
      mintReconnectStop = () =>
        window.removeEventListener("online", handleOnline);
    }

    // mintQuoteObserver에 OperationMap + TxRepo 주입 (TX 이중 생성 방지)
    const { injectDependencies } = await import(
      "@/composition/mint-quote-observer"
    );
    injectDependencies(operationMap, txRepo);

    // Mint quote observer (mint-op:finalized → Transaction DB 기록)
    const { connectMintQuoteObserver } = await import(
      "@/composition/mint-quote-observer"
    );
    connectMintQuoteObserver(manager);

    // Send token observer 연결 (bootstrap과 동일 인스턴스 공유)
    const { connectSendTokenObserver } = await import(
      "@/composition/send-token-observer"
    );
    connectSendTokenObserver(manager, {
      operationMap,
      lifecycle: reclaim,
    });

    // Transfer SDK Bridge: Coco push events → TLS transfer resolution
    const { connectTransferSdkBridge } = await import(
      "@/composition/transfer-sdk-bridge"
    );
    connectTransferSdkBridge(manager, transferLifecycle);

    // Coco → EventBus bridge
    connectCocoEventBridge(manager, eventBus);

    // Watchers
    await enableCashuWatchers();

    // Nostr incoming watcher 시작 (앱 unlock 후 한 번)
    nostrIncomingWatcher.start(derivePublicKey(deps.nostrPrivateKeyHex));

    // TLS: 앱 시작 시 active transfer 복구 + 감시 시작 (ks 분기 — §7.2)
    transferLifecycle.recoverTransfers().catch(console.error);
    wireTransferSweepSignals();
    if (!paused) {
      startTransferMonitor();
    }

    // Coco SDK 내부 stuck mint ops 정리 (1일 이상 → abandon, 그 외 → 복구 시도)
    import('@/modules/cashu/internal/cashu-recovery')
      .then(({ cleanAndRecoverStaleMintOps }) => cleanAndRecoverStaleMintOps().catch(console.error))
      .catch(() => {});
  };

  const onResume = async () => {
    paused = false;
    // 판정은 heartbeat 재개로 갱신되기 전에 — 이번 부재가 5분을 넘겼는지가 기준
    const shouldRecheck = awayLongEnough();
    startAliveHeartbeat();
    try {
      await resumeCashuSubscriptions();
      // 모바일 freeze 중의 online 전환은 'online' 이벤트를 남기지 않는다 —
      // resume에서 watcher 활성화를 재시도해야 §7.1-3 결함이 실제로 닫힌다
      // (watchersEnabled 가드로 idempotent, 오프라인이면 재시도 재예약. 코드리뷰 #4).
      enableCashuWatchers().catch((e) =>
        console.error("[Resume] watcher enable failed:", e)
      );
      // recheck(watcher 재기동 → pending quote 전수 재확인)는 5분 초과 부재에만
      // (설계 §6.3 resume / [F12]) — 짧은 전환마다 전수 재확인하던 버스트 제거.
      // 짧은 부재의 공백은 구독 재개 + 브리지 push가 커버한다.
      // 참고: pause를 거친 resume에서는 위 enable이 아직 flag를 못 세워
      // recheck가 no-op일 수 있다 — enable 자체가 pending 전수를 재구독하므로
      // 결과는 동등하다. recheck의 실효 경로는 pause 이벤트 없이 얼었다 깨어난
      // freeze 복귀(flag가 true로 남은 경우)다 (4단계 재검증 잔여 #1).
      if (shouldRecheck) {
        recheckCashuPendingMintQuotes().catch((e) =>
          console.error("[Resume] recheck quotes failed:", e)
        );
      }
    } catch {
      /* ignore if not initialized */
    }
    exchangeRateService.refreshIfStale().catch(() => {});

    // TLS 감시 재개 — onPause에서 정지한 타이머 (설계 §7.2). sweep 경로는
    // 즉시 1회 sweep 후 타이머 재개(pending 0이면 스스로 정지). idempotent.
    startTransferMonitor();

    // Nostr incoming watcher 재시작 (키가 바뀔 수 있으므로)
    nostrIncomingWatcher.stop();
    nostrIncomingWatcher.start(derivePublicKey(deps.nostrPrivateKeyHex));
  };

  const onPause = async () => {
    paused = true;
    // 백그라운드 진입 시각을 마지막으로 기록하고 heartbeat 정지 —
    // 이후 부재 시간이 그대로 lastAliveAt과의 간격이 된다
    markAlive();
    stopAliveHeartbeat();
    try {
      await pauseCashuSubscriptions();
    } catch {
      /* ignore if not initialized */
    }
    // TLS 감시 정지 — 기존에는 백그라운드에서도 30초 폴링이 계속 돌았다 (설계 §7.2).
    stopTransferMonitor();
    // 카운터 flush — pagehide 외에 pause 시점에도 확정 저장 (설계 §12)
    void flushNetCounters();
  };

  // 등록 교체(재unlock)·잠금 시 리소스 정리 — 이전 bootstrap의 flusher/폴링/구독/
  // 헬스체크 타이머가 세대를 넘어 살아남는 누수 방지 (코드리뷰 #5).
  const dispose = () => {
    if (netCounterFlusherStop) {
      netCounterFlusherStop();
      netCounterFlusherStop = null;
    }
    if (mintReconnectStop) {
      mintReconnectStop();
      mintReconnectStop = null;
    }
    stopAliveHeartbeat();
    stopTransferMonitor();
    if (transferSweepWiringStop) {
      transferSweepWiringStop();
    }
    nostrIncomingWatcher.stop();
    void nostrGateway.disconnect();
  };

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


  // 13. Phase 6: New services
  const cryptoGateway = new CryptoGatewayAdapter();
  const crypto = new CryptoService(cryptoGateway);

  const inputParser = new InputParserService(tokenCodec, lnurlAdapter);

  const feeEstimator = new CashuFeeEstimatorAdapter(cashuBackend);
  const routing = new RoutingService(feeEstimator);

  const stripTrailingSlash = (url: string) => url.replace(/\/+$/, "");
  // 분기 A 스코프 가드 (설계 §5.4 / 구현 리뷰 #7): Coco getMintInfo는 미등록
  // URL도 repo에 등록하고 keyset까지 내려받는다 — metadata 경로는 등록 민트로
  // 한정한다. 미등록 URL 검증은 fresh probe(분기 B)의 몫.
  const scopedCocoMintInfoFetcher = async (mintUrl: string) => {
    const registered = useAppStore
      .getState()
      .settings.mints.some((m) => isSameMintUrl(m, mintUrl));
    if (!registered) return null;
    return getMintInfoFromCoco(mintUrl);
  };

  const mintMetadataServiceInstance = new MintMetadataService(
    new DexieMintMetadataRepository(),
    // 분기 A (설계 §5.4 / SP-1): 24h 캐시 미스 시 Coco 경유 — repo+5분 TTL
    // 하이브리드, limiter 보호. ks.mint-info-facade ON이면 레거시 직접 fetch로 복귀.
    killSwitches["mint-info-facade"] ? undefined : scopedCocoMintInfoFetcher
  );
  const mintMetadataStore = new MintMetadataStoreAdapter(
    mintMetadataServiceInstance,
    metadataEvents
  );
  const mintMetadata = new MintMetadataFacadeService(mintMetadataStore);

  // /v1/info 단일 소유자 (설계 §5): health probe(30s, 분기 B — 유일한 직접 fetch)
  // + 상세 화면 raw info(24h 캐시) + probe→metadata 역주입(이중 타격 제거)
  const mintInfoService = new MintInfoService(mintMetadataServiceInstance);
  const mintHealthChecker = killSwitches["mint-info-facade"]
    ? new MintHealthCheckerAdapter()
    : mintInfoService;
  const mintHealth = new MintHealthFacadeService(mintHealthChecker);

  // ks.mint-info-facade ON일 때의 registry.mintInfo — 구동작 복원 (구현 리뷰 #2):
  // 화면별 개별 raw fetch와 동일한 시맨틱(ingest/미러/캐시 없음). 스위치는 신경로
  // 전체를 꺼야 롤백 수단으로 성립한다.
  const legacyMintInfo: MintInfoUseCase = {
    async getInfo(mintUrl: string) {
      try {
        const res = await fetch(`${stripTrailingSlash(mintUrl)}/v1/info`);
        if (!res.ok) return null;
        return (await res.json()) as MintInfoData;
      } catch {
        return null;
      }
    },
  };
  const mintInfo = killSwitches["mint-info-facade"]
    ? legacyMintInfo
    : mintInfoService;

  const sendTokenOperator = new CashuSendTokenOperatorAdapter();
  const reclaim = new ReclaimService(
    txRepo,
    sendTokenOperator,
    tokenReceiver,
    pendingOpRepo,
    eventBus
  );
  const transactionMgmt = new TransactionMgmtService(txRepo);
  const routePaymentOperator = new CashuRoutePaymentOperatorAdapter(
    cashuBackend,
    {
      markQuoteAsSwap,
      unmarkQuoteAsSwap,
    }
  );
  const routeExecution = new RouteExecutionService(
    routePaymentOperator,
    txRepo,
    new DexieRouteExecutionStore(),
    new PaymentDelivery(outgoingTransport, decodeTokenForPaymentPayload),
    tokenCodec,
    lnurlAdapter,
    eventBus,
    transferLifecycle,
    new CrossTabSyncNotifierAdapter()
  );

  // NUT-18 poller factory — expiresAt 전달이 계약의 일부다 (설계 §8.1).
  // 인라인 람다 시절 expiresAt 유실로 만료 후 30분 폴링 결함이 있었고,
  // nut18-poller-factory.test.ts가 필드 전수 전달을 회귀 감시한다.
  const paymentRequest = new PaymentRequestService(
    tokenCodec,
    createNut18HttpPollerFactory(),
  );

  const zappiLinkProvider = new ZappiLinkAdapter(
    (privateKeyHex, url, method) => {
      const event = finalizeEvent(
        {
          kind: NOSTR_KINDS.NIP98_AUTH,
          content: "",
          tags: [
            ["u", url],
            ["method", method.toUpperCase()],
          ],
          created_at: Math.floor(Date.now() / 1000),
        },
        hexToBytes(privateKeyHex)
      );
      return btoa(JSON.stringify(event));
    }
  );
  const username = new UsernameService(zappiLinkProvider);

  const trustRegistry = new TrustRegistryService(settingsRepo);
  const nostrDirectPayment = new NostrDirectPaymentService(addressResolver);
  const externalWalletRecovery = new ExternalWalletRecoveryService(
    externalMnemonicMintDiscovery,
    externalMnemonicRecovery,
    new PaymentRecoveredTokenReceiver(payment),
    new SettingsTrustedAccountStoreAdapter(settingsRepo, (mints) =>
      useAppStore.getState().updateSettings({ mints })
    ),
    eventBus
  );
  const support = createSupportService({ bip39Seed: deps.bip39Seed });

  return {
    // ─── ServiceRegistry (driving ports only) ───
    eventBus,
    payment,
    balance,
    swap,
    contact,
    profile,
    inputRouter,
    addressResolver,
    recovery,
    incomingPayment,
    recoveryScheduler,
    processedStore,
    incomingReviewQueue,
    nostrGateway,
    pendingItems,
    mintMetadata,
    mintHealth,
    mintInfo,
    crypto,
    receiveRequest,
    reclaim,
    transactionMgmt,
    inputParser,
    paymentRequest,
    routing,
    username,
    trustRegistry,
    support,
    nostrDirectPayment,
    externalWalletRecovery,
    transferLifecycle,

    // ─── BootstrapResult extensions (MainApp only) ───
    cashuModule,
    operationMap,

    // Lifecycle
    activate,
    onResume,
    onPause,
    dispose,
    disconnectBridge,
    disconnectGiftWrapSettlement,

    // Balance refresh (store 갱신 포함)
    refreshBalance: balanceRefresh,

    // Cleanup — 로그아웃 전체 소거는 composition/logout.ts 소관
    cleanup: {
      clearMintData: (mintUrl: string) =>
        removeMintArtifacts(
          {
            txRepo,
            removeMintFromSdk: removeMintFromCoco,
            clearLocalMintData: clearMintData,
          },
          mintUrl
        ),
    },

    // Exchange rate
    exchangeRate: {
      loadCachedRates: () => exchangeRateService.loadCachedRates(),
      fetchRates: () => {
        exchangeRateService.fetchRates().catch(() => {});
      },
      refreshIfStale: () => exchangeRateService.refreshIfStale(),
    },

    // Routing
    executeRoute: (selection: RouteSelection, context: RouteContext) =>
      routeExecution.executeRoute(selection, context),

    // Nostr incoming watcher
    nostrIncomingWatcher,

    // P2PK + offline token
    p2pkKeyManager,
    storeOfflineToken: (
      token: string,
      amount: number,
      mintUrl: string,
      dleqStatus: "valid" | "missing"
    ) => cashuBackend.storeOfflineToken(token, amount, mintUrl, dleqStatus),
    trustMint: trustMintInCoco,
  };
}
