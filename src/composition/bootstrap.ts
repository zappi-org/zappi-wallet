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
  deleteCocoData,
  markQuoteAsSwap,
  removeMintFromCoco,
  unmarkQuoteAsSwap,
} from "@/modules/cashu";
import { clearMintData } from "@/adapters/storage/dexie/schema";
import { resetWalletCache } from "@/adapters/cache/wallet-cache";
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
import { IncomingReviewQueueAdapter } from "@/adapters/runtime/incoming-review-queue.adapter";
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
  startNetCounterFlusher,
} from "@/adapters/telemetry/net-counters";
import { ZappiLinkAdapter } from "@/adapters/zappi-link/zappi-link.adapter";
import { finalizeEvent } from "nostr-tools";
import { hexToBytes } from "@noble/hashes/utils.js";
import { DEFAULT_RELAYS, NOSTR_KINDS } from "@/core/constants";
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

  // ─── Cleanup (로그아웃용) ───
  readonly cleanup: {
    deleteCocoData(): Promise<void>;
    clearWalletCache(): void;
    clearMintData(mintUrl: string): Promise<void>;
    resetWalletCache(): void;
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
  const incomingReviewQueue = new IncomingReviewQueueAdapter((review) =>
    useAppStore.getState().enqueueIncomingReview(review)
  );

  // 2. Nostr Gateway
  const nostrGateway = new NostrGatewayAdapter({
    privateKeyHex: deps.nostrPrivateKeyHex,
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
    operationMap
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
  // pause-during-activate 레이스 가드 (코드리뷰 #6): activate의 startPolling이
  // 이미 백그라운드로 간 앱에서 타이머를 켜는 것을 방지.
  let paused = false;
  const activate = async () => {
    const manager = await getCashuRuntimeManager();

    // 프로덕션 집계 카운터 flush 주기 시작 (설계 §12) — 재호출에도 1회만
    if (!netCounterFlusherStop) {
      netCounterFlusherStop = startNetCounterFlusher();
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

    // TLS: 앱 시작 시 active transfer 복구 + 주기적 폴링 시작 (long-interval fallback)
    transferLifecycle.recoverTransfers().catch(console.error);
    if (!paused) {
      transferLifecycle.startPolling(30000);
    }

    // Coco SDK 내부 stuck mint ops 정리 (1일 이상 → abandon, 그 외 → 복구 시도)
    import('@/modules/cashu/internal/cashu-recovery')
      .then(({ cleanAndRecoverStaleMintOps }) => cleanAndRecoverStaleMintOps().catch(console.error))
      .catch(() => {});
  };

  const onResume = async () => {
    paused = false;
    try {
      await resumeCashuSubscriptions();
      // 모바일 freeze 중의 online 전환은 'online' 이벤트를 남기지 않는다 —
      // resume에서 watcher 활성화를 재시도해야 §7.1-3 결함이 실제로 닫힌다
      // (watchersEnabled 가드로 idempotent, 오프라인이면 재시도 재예약. 코드리뷰 #4).
      enableCashuWatchers().catch((e) =>
        console.error("[Resume] watcher enable failed:", e)
      );
      recheckCashuPendingMintQuotes().catch((e) =>
        console.error("[Resume] recheck quotes failed:", e)
      );
    } catch {
      /* ignore if not initialized */
    }
    exchangeRateService.refreshIfStale().catch(() => {});

    // TLS 폴링 재개 — onPause에서 정지한 타이머 (설계 §7.2). startPolling은 idempotent.
    // 주기 30초는 현행 유지 — 120s stuck-sweep 전환은 5단계(커버리지 게이트 통과 후).
    transferLifecycle.startPolling(30000);

    // Nostr incoming watcher 재시작 (키가 바뀔 수 있으므로)
    nostrIncomingWatcher.stop();
    nostrIncomingWatcher.start(derivePublicKey(deps.nostrPrivateKeyHex));
  };

  const onPause = async () => {
    paused = true;
    try {
      await pauseCashuSubscriptions();
    } catch {
      /* ignore if not initialized */
    }
    // TLS 폴링 정지 — 기존에는 백그라운드에서도 30초 폴링이 계속 돌았다 (설계 §7.2).
    transferLifecycle.stopPolling();
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
    transferLifecycle.stopPolling();
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
    () => useAppStore.getState().pendingEcashRequestId
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
    txRepo
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

  // 12. WithdrawUseCase / LnurlAuthUseCase — TODO: NoOp impl or real impl
  // Phase 5에서는 undefined 허용하지 않으므로 placeholder
  const withdraw = {} as ServiceRegistry["withdraw"];
  const lnurlAuth = {} as ServiceRegistry["lnurlAuth"];

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

  const mintHealthChecker = new MintHealthCheckerAdapter();
  const mintHealth = new MintHealthFacadeService(mintHealthChecker);

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
    processedStore,
    nostrGateway,
    pendingItems,
    withdraw,
    lnurlAuth,
    mintMetadata,
    mintHealth,
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
      resetWalletCache,
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
