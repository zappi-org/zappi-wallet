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
import { readKillSwitches } from "@/core/utils/kill-switch";

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
import { DexiePaymentAliasProcessedQuotesRepository } from "@/adapters/storage/dexie/dexie-payment-alias-processed-quotes.repository";
import { DexieLightningReceiptCursorStore } from "@/adapters/storage/dexie/dexie-lightning-receipt-cursor.store";
import { DexieGiftwrapCursorStore } from "@/adapters/storage/dexie/dexie-giftwrap-cursor.store";
import { RecoveryStoreAdapter } from "@/adapters/storage/recovery-store.adapter";

// ─── Legacy services (composition root만 wrap 가능) ───
import { readNetCounters, incrementNetCounter, flushNetCounters, startNetCounterFlusher } from "@/adapters/telemetry/net-counters";
import { exchangeRateService } from "./exchange-rate";
import { broadcastSync, getBroadcastChannel } from "@/utils/cross-tab-sync";
import { resolveIncomingReview } from "./incoming-review";

// ─── Coco (composition root만 접근) ───
import {
  addMint as trustMintInCoco,
  createExternalMnemonicRecovery,
  decodeTokenForPaymentPayload,
  deleteCocoData,
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
import { PaymentAliasService } from "@/core/services/payment-alias.service";
import { ClaimStorageService } from "@/core/services/claim-storage.service";
import { TrustRegistryService } from "@/core/services/trust-registry.service";
import { NostrDirectPaymentService } from "@/core/services/nostr-direct-payment.service";
import { RouteExecutionService } from "@/core/services/route-execution.service";
import { ExternalWalletRecoveryService } from "@/core/services/external-wallet-recovery.service";
import { TransferLifecycleService } from "@/core/services/transfer-lifecycle.service";
import { RecoverySchedulerService } from "@/core/services/recovery-scheduler.service";
import { DexiePendingTransferStore } from "@/adapters/storage/dexie/dexie-pending-transfer-store";

// ─── Cashu Adapters (TransferOperator 구현체) ───
import { CashuBolt11Adapter } from "@/modules/cashu/adapters/cashu-bolt11.adapter";
import { CashuEcashAdapter } from "@/modules/cashu/adapters/cashu-ecash.adapter";

// ─── Phase 6: Metadata + NUT-18 HTTP ───
import { MintInfoService } from "@/modules/cashu/mint-info.service";
import { MintMetadataService, metadataEvents } from "@/modules/cashu/metadata";
import {
  enableCashuWatchers,
  getCashuKeyring,
  getCashuRuntimeManager,
  pauseCashuSubscriptions,
  recheckCashuPendingMintQuotes,
  resumeCashuSubscriptions,
} from "@/modules/cashu/cashu-runtime";
import { DexieMintMetadataRepository } from "@/adapters/storage/dexie/dexie-mint-metadata.repository";
import { startNut18HttpPoller } from "@/adapters/codec/nut18-http-poller";
import { NpubcashAdapter } from "@/adapters/npubcash/npubcash.adapter";
import { Secp256k1NostrSignerAdapter } from "@/adapters/crypto/secp256k1-nostr-signer";
import { DEFAULT_RELAYS, NPUBCASH_URL, NPUBCASH_DOMAIN, STORAGE_KEYS } from "@/core/constants";
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
import { createNpubcashQuoteWatcher } from "./npubcash-quote-watcher";
import { createClaimStoragePoller } from "./claim-storage-poller";
import { createNut18HttpPollerFactory } from "./nut18-poller-factory";

// ─── Types ───
import type { WalletModule } from "@/core/ports/driven/wallet-module.port";
import type { OperationMap } from "@/core/ports/driven/operation-map.port";
import type { ServiceRegistry } from "@/core/ports/driving/service-registry";
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
import type { Result } from "@/core/domain/result";
import type { MintInfoData } from "@/core/types";
import type { MintInfoUseCase } from "@/core/ports/driving/mint-info.usecase";
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
  dispose(): void;
  disconnectBridge(): void;
  disconnectGiftWrapSettlement(): void;

  // ─── Balance refresh (store 갱신 포함, composition root 와이어링) ───
  refreshBalance(): Promise<void>;

  // ─── Cleanup (로그아웃용) ───
  readonly cleanup: {
    deleteCocoData(): Promise<void>;
    clearWalletCache(): void;
    clearMintData(mintUrl: string): Promise<void>;
    clearBalanceCache(): void;
    deleteAllContacts(): Promise<void>;
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

  // ─── Npubcash quote watcher ───
  readonly npubcashQuoteWatcher: { start(): Promise<void>; stop(): void; syncNow(): Promise<void> };

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
  const killSwitches = readKillSwitches();

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
  const incomingReviewQueue = new DexieIncomingReviewQueue({
    onEnqueued: (review) =>
      useAppStore.getState().enqueueIncomingReview(review),
    onRemoved: (externalId) =>
      useAppStore.getState().removeIncomingReview(externalId),
  });

  // 2. Nostr Gateway
  const giftwrapCursorStore = killSwitches.cursor
    ? undefined
    : new DexieGiftwrapCursorStore();
  const nostrGateway = new NostrGatewayAdapter({
    privateKeyHex: deps.nostrPrivateKeyHex,
    cursorStore: giftwrapCursorStore,
    useSessionController: !killSwitches['nostr-controller'],
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
    {
      stuckDetected: () => incrementNetCounter('tls_stuck_detected'),
      stuckConfirmedSettled: () =>
        incrementNetCounter('tls_stuck_confirmed_settled'),
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

  // RecoveryScheduler + delegate: decomposes recoverAll into per-behavior actions
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
        (op) => op.kind === 'send-token' && !op.metadata?.operationId
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
        result: 'skipped',
        error: reason,
      });
      await incomingReviewQueue.remove(review.externalId);
    },
  });

  if (!killSwitches['recovery-split']) {
    payment.setRecoveryDelegate(async (opts) => {
      try {
        const rec = await recoveryScheduler.reconcile();
        console.log(
          `[Recovery] reconcile: settled=${rec.settled} reclaimed=${rec.reclaimed} failed=${rec.failed} cleaned=${rec.cleaned}`
        );
      } catch (e) {
        console.warn('[Recovery] reconcile failed:', e);
      }
      try {
        const report = await recoveryScheduler.recoverTargeted({
          bypassGate: opts?.bypassGate,
        });
        if (report.recovered > 0) {
          eventBus.emit({ type: 'recovery:completed', payload: report });
        }
        return [report];
      } catch (e) {
        console.warn('[Recovery] targeted failed:', e);
        return [{ moduleId: 'cashu', recovered: 0, failed: 1 }];
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

  // 8. Lifecycle state
  const LAST_ALIVE_KEY = STORAGE_KEYS.LAST_ALIVE;
  const RESUME_RECHECK_THRESHOLD_MS = 5 * 60 * 1000;
  let paused = false;
  let netCounterFlusherStop: (() => void) | null = null;
  let mintReconnectStop: (() => void) | null = null;
  let transferSweepWiringStop: (() => void) | null = null;
  let aliveHeartbeatStop: (() => void) | null = null;

  const markAlive = () => {
    try {
      localStorage.setItem(LAST_ALIVE_KEY, String(Date.now()));
    } catch {
      /* storage unavailable */
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
  const startTransferMonitor = () => {
    if (killSwitches['tls-sweep']) {
      transferLifecycle.startPolling(30000);
    } else {
      transferLifecycle.startStuckSweep(120_000);
    }
  };
  const stopTransferMonitor = () => {
    transferLifecycle.stopPolling();
    transferLifecycle.stopStuckSweep();
  };
  const wireTransferSweepSignals = () => {
    if (transferSweepWiringStop) return;
    const unsubs: Array<() => void> = [];
    unsubs.push(
      eventBus.on('transfer:submitted', () => {
        broadcastSync('transfer_created');
      })
    );
    unsubs.push(
      eventBus.on('incoming:received', () => {
        transferLifecycle.ensureSweepScheduled();
        broadcastSync('transfer_created');
      })
    );
    const channel = getBroadcastChannel();
    if (channel) {
      const onMessage = (event: MessageEvent) => {
        if ((event.data as { type?: string })?.type === 'transfer_created') {
          transferLifecycle.ensureSweepScheduled();
        }
      };
      channel.addEventListener('message', onMessage);
      unsubs.push(() => channel.removeEventListener('message', onMessage));
    }
    transferSweepWiringStop = () => {
      unsubs.forEach((u) => u());
      transferSweepWiringStop = null;
    };
  };

  // Lifecycle: activate (Coco init + observers + watchers + bridge)
  const activate = async () => {
    const manager = await getCashuRuntimeManager();

    if (!netCounterFlusherStop) {
      netCounterFlusherStop = startNetCounterFlusher();
    }

    startAliveHeartbeat();

    nostrGateway
      .connect([
        ...new Set([...DEFAULT_RELAYS, ...useAppStore.getState().settings.relays]),
      ])
      .catch((e) => console.warn('[Bootstrap] relay connect failed:', e));

    incomingReviewQueue
      .listAll()
      .then((reviews) => {
        const { enqueueIncomingReview } = useAppStore.getState();
        reviews.forEach(enqueueIncomingReview);
      })
      .catch((e) => console.error('[Bootstrap] review hydrate failed:', e));

    if (!mintReconnectStop && typeof window !== 'undefined') {
      const handleOnline = () => {
        mintHealth
          .checkAllMints(useAppStore.getState().settings.mints)
          .catch(() => {});
      };
      window.addEventListener('online', handleOnline);
      mintReconnectStop = () =>
        window.removeEventListener('online', handleOnline);
    }

    // mintQuoteObserver에 OperationMap + TxRepo 주입 (TX 이중 생성 방지)
    const { injectDependencies } = await import(
      "@/composition/mint-quote-observer"
    );
    injectDependencies(operationMap, txRepo);

    const { connectMintQuoteObserver } = await import(
      "@/composition/mint-quote-observer"
    );
    connectMintQuoteObserver(manager);

    const { connectSendTokenObserver } = await import(
      "@/composition/send-token-observer"
    );
    connectSendTokenObserver(manager, {
      operationMap,
      lifecycle: reclaim,
    });

    const { connectTransferSdkBridge } = await import(
      "@/composition/transfer-sdk-bridge"
    );
    connectTransferSdkBridge(manager, transferLifecycle);

    connectCocoEventBridge(manager, eventBus);

    await enableCashuWatchers();

    nostrIncomingWatcher.start(derivePublicKey(deps.nostrPrivateKeyHex));

    npubcashQuoteWatcher.start().catch(console.error);

    claimStoragePoller.start();

    transferLifecycle.recoverTransfers().catch(console.error);
    wireTransferSweepSignals();
    if (!paused) {
      startTransferMonitor();
    }

    import('@/modules/cashu/internal/cashu-recovery')
      .then(({ cleanAndRecoverStaleMintOps }) => cleanAndRecoverStaleMintOps().catch(console.error))
      .catch(() => {});
  };

  const onResume = async () => {
    paused = false;
    const shouldRecheck = awayLongEnough();
    startAliveHeartbeat();
    try {
      await resumeCashuSubscriptions();
      enableCashuWatchers().catch((e) =>
        console.error('[Resume] watcher enable failed:', e)
      );
      if (shouldRecheck) {
        recheckCashuPendingMintQuotes().catch((e) =>
          console.error('[Resume] recheck quotes failed:', e)
        );
      }
    } catch {
      /* ignore if not initialized */
    }
    exchangeRateService.refreshIfStale().catch(() => {});

    startTransferMonitor();

    nostrIncomingWatcher.stop();
    nostrIncomingWatcher.start(derivePublicKey(deps.nostrPrivateKeyHex));

    npubcashQuoteWatcher.stop();
    npubcashQuoteWatcher.start().catch(console.error);

    claimStoragePoller.stop();
    claimStoragePoller.start();
  };

  const onPause = async () => {
    paused = true;
    markAlive();
    stopAliveHeartbeat();
    try {
      await pauseCashuSubscriptions();
    } catch {
      /* ignore if not initialized */
    }
    stopTransferMonitor();
    void flushNetCounters();
    npubcashQuoteWatcher.stop();
    claimStoragePoller.stop();
  };

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
    npubcashQuoteWatcher.stop();
    claimStoragePoller.stop();
    disconnectBridge();
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

  const mintMetadataServiceInstance = new MintMetadataService(
    new DexieMintMetadataRepository()
  );
  const mintMetadataStore = new MintMetadataStoreAdapter(
    mintMetadataServiceInstance,
    metadataEvents
  );
  const mintMetadata = new MintMetadataFacadeService(mintMetadataStore);

  const mintInfoService = new MintInfoService(mintMetadataServiceInstance);
  const mintHealthChecker = killSwitches['mint-info-facade']
    ? new MintHealthCheckerAdapter()
    : mintInfoService;
  const mintHealth = new MintHealthFacadeService(mintHealthChecker);

  const legacyMintInfo: MintInfoUseCase = {
    async getInfo(mintUrl: string) {
      try {
        const res = await fetch(`${mintUrl.replace(/\/+$/, '')}/v1/info`);
        if (!res.ok) return null;
        return (await res.json()) as MintInfoData;
      } catch {
        return null;
      }
    },
  };
  const mintInfo = killSwitches['mint-info-facade']
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
    {
      ...cashuBackend,
      parsePaymentRequest: async (encodedRequest: string) => {
        const resolved = await cashuBackend.parsePaymentRequest(encodedRequest)
        return {
          ...resolved,
          amount: resolved.amount ?? 0,
        }
      },
    },
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

  const paymentRequest = new PaymentRequestService(
    tokenCodec,
    createNut18HttpPollerFactory(startNut18HttpPoller)
  );

  const npubcashAdapter = new NpubcashAdapter(NPUBCASH_URL);
  const paymentAlias = new PaymentAliasService(
    npubcashAdapter,
    routePaymentOperator,
    (privkey: string) => new Secp256k1NostrSignerAdapter(privkey),
    txRepo,
    routePaymentOperator,
    eventBus,
    NPUBCASH_DOMAIN,
  );

  const claimStorage = new ClaimStorageService(
    npubcashAdapter,
    (privkey: string) => new Secp256k1NostrSignerAdapter(privkey),
    eventBus,
  );

  const claimStoragePoller = createClaimStoragePoller({
    provider: npubcashAdapter,
    createSigner: (privkey: string) => new Secp256k1NostrSignerAdapter(privkey),
    getPrivkey: () => useAppStore.getState().nostrPrivkey,
    redeemToken: async (token: string) => {
      const result = await payment.redeem({ input: token })
      if (!result.ok) throw result.error
    },
  });

  const npubcashQuoteWatcher = createNpubcashQuoteWatcher({
    provider: npubcashAdapter,
    mint: routePaymentOperator,
    createSigner: (privkey: string) => new Secp256k1NostrSignerAdapter(privkey),
    getPrivkey: () => useAppStore.getState().nostrPrivkey,
    getPubkey: () => useAppStore.getState().nostrPubkey,
    eventBus,
    processedQuotesRepo: new DexiePaymentAliasProcessedQuotesRepository(),
    cursorStore: new DexieLightningReceiptCursorStore(),
  });

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
    recoveryScheduler,
    incomingPayment,
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
    paymentAlias,
    claimStorage,
    trustRegistry,
    support,
    nostrDirectPayment,
    externalWalletRecovery,
    diagnostics: { readNetCounters },
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

    // Cleanup
    cleanup: {
      deleteCocoData,
      clearWalletCache: () => {
        /* no-op: cashu-ts wallet cache no longer used */
      },
      clearMintData: (mintUrl: string) =>
        removeMintArtifacts(
          {
            txRepo,
            removeMintFromSdk: removeMintFromCoco,
            clearLocalMintData: clearMintData,
          },
          mintUrl
        ),
      clearBalanceCache: () => balanceCache.clear(),
      deleteAllContacts: () => contactRepo.deleteAll(),
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

    // Npubcash quote watcher
    npubcashQuoteWatcher,

    // Claim storage poller
    claimStoragePoller,

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
