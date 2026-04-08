/**
 * Bootstrap — Composition Root (유일한 경계 횡단 지점)
 *
 * 이 파일만 modules/, adapters/, core/services/ 전부 import 가능.
 * 모든 어댑터를 생성하고, 서비스를 조립하여 ServiceRegistry를 반환.
 *
 * 호출 시점: MainApp.tsx에서 unlock 이후 (seed + nostrPrivkey 필요)
 */

// ─── Core ───
import { createEventBus } from '@/core/events/event-bus'
import { toNumber } from '@/core/domain/amount'

// ─── Store (composition root만 접근) ───
import { useAppStore } from '@/store'

// ─── Modules (bootstrap만 import 허용) ───
import { CashuModule } from '@/modules/cashu/cashu.module'
import { createCashuBackend } from '@/modules/cashu/create-cashu-backend'

// ─── Adapters ───
import { DexieTransactionRepository } from '@/adapters/storage/dexie/dexie-transaction.repository'
import { DexieContactRepository } from '@/adapters/storage/dexie/dexie-contact.repository'
import { DexiePendingOperationRepository } from '@/adapters/storage/dexie/dexie-pending-operation.repository'
import { DexieOperationMap } from '@/adapters/storage/dexie/dexie-operation-map'
import { DexieOfflineTokenStore } from '@/adapters/storage/dexie/dexie-offline-token-store'
import { NostrGatewayAdapter } from '@/adapters/nostr/nostr-gateway'
import { NostrPaymentTransport } from '@/adapters/nostr/nostr-payment-transport'
import { derivePublicKey } from '@/adapters/nostr/internal/nostr-crypto'
import { FailedIncomingStoreAdapter } from '@/adapters/storage/failed-incoming-store.adapter'
import { CocoP2PKKeyManager } from '@/adapters/crypto/p2pk-key-manager.adapter'

// ─── Adapters (non-module) ───
import { DirectLnurlAdapter } from '@/adapters/lnurl/direct-lnurl.adapter'
import { Nip05ResolverAdapter } from '@/adapters/nip05/nip05-resolver'
import { DexieSettingsRepository as SettingsRepository } from '@/adapters/storage/dexie/dexie-settings.repository'
import { DexieProcessedRepository as ProcessedRepository } from '@/adapters/storage/dexie/dexie-processed.repository'

// ─── Legacy services (composition root만 wrap 가능) ───
import { exchangeRateService } from './exchange-rate'
import { executeRoute as legacyExecuteRoute } from './routing'

// ─── Coco (composition root만 접근) ───
import { deleteCocoData } from '@/modules/cashu'
import { clearMintData } from '@/adapters/storage/dexie/schema'
import { resetWalletCache } from '@/adapters/cache/wallet-cache'

// ─── Phase 6: New Adapters ───
import { CryptoGatewayAdapter } from '@/adapters/crypto/crypto-gateway.adapter'
import { TokenCodecAdapter } from '@/adapters/codec/token-codec.adapter'
import { FeeEstimatorAdapter } from '@/adapters/coco/fee-estimator.adapter'
import { SendTokenOperatorAdapter } from '@/adapters/coco/send-token-operator.adapter'
import { MintHealthCheckerAdapter } from '@/adapters/health/mint-health-checker.adapter'
import { MintMetadataStoreAdapter } from '@/adapters/metadata/mint-metadata-store.adapter'

// ─── Phase 6: New Core Services ───
import { CryptoService } from '@/core/services/crypto.service'
import { InputParserService } from '@/core/services/input-parser.service'
import { RoutingService } from '@/core/services/routing.service'
import { MintMetadataFacadeService } from '@/core/services/mint-metadata-facade.service'
import { MintHealthFacadeService } from '@/core/services/mint-health-facade.service'
import { TransactionMgmtService } from '@/core/services/transaction-mgmt.service'
import { ReceiveRequestFacadeService } from '@/core/services/receive-request-facade.service'
import { PaymentRequestService } from '@/core/services/payment-request.service'
import { UsernameService } from '@/core/services/username.service'

// ─── Phase 6: Metadata + NUT-18 HTTP ───
import { MintMetadataService, metadataEvents } from '@/modules/cashu/metadata'
import { DexieMintMetadataRepository } from '@/adapters/storage/dexie/dexie-mint-metadata.repository'
import { startNut18HttpPoller } from '@/adapters/codec/nut18-http-poller'
import { ZappiLinkAdapter } from '@/adapters/zappi-link/zappi-link.adapter'
import { finalizeEvent } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils.js'
import { NOSTR_KINDS } from '@/core/constants'
import { DexieReceiveRequestRepository } from '@/adapters/storage/dexie/dexie-receive-request.repository'

// ─── Composition Roots ───
import { createPaymentService } from './payment'
import { createBalanceService } from './balance'
import { createSwapService } from './swap'
import { createContactService } from './contact'
import { createInputRouter } from './input-router'
import { createAddressResolver } from './address-resolver'
import { createProfileService } from './profile'
import { createRecoveryService } from './recovery'
import { IncomingPaymentService } from '@/core/services/incoming-payment.service'
import { createPendingItemsService } from './pending-items'
import { connectEventStoreBridge } from './event-store-bridge'
import { connectCocoEventBridge } from './coco-event-bridge'
import { GiftWrapWatcher } from './gift-wrap.watcher'

// ─── Types ───
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { OperationMap } from '@/core/ports/driven/operation-map.port'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'

// ─── Routing types (Phase 6에서 SendFlow 전환 시 제거) ───
export type { RouteSelection, RouteContext, RouteExecutionResult } from '@/core/domain/routing'
import type { RouteSelection, RouteContext, RouteExecutionResult } from '@/core/domain/routing'
import type { Result } from '@/core/types/result'
import type { BaseError } from '@/core/errors'

export type RouteResult = Result<RouteExecutionResult, BaseError>


// ─── Bootstrap Input ───

export interface BootstrapDeps {
  /** Nostr 개인키 (hex) — unlock 후 사용 가능 */
  nostrPrivateKeyHex: string
}

export interface BootstrapResult extends ServiceRegistry {
  // ─── Module instances ───
  readonly cashuModule: CashuModule
  readonly operationMap: OperationMap

  // ─── Lifecycle (MainApp만 호출) ───
  activate(): Promise<void>
  onResume(): Promise<void>
  onPause(): Promise<void>
  disconnectBridge(): void

  // ─── Balance refresh (store 갱신 포함, composition root 와이어링) ───
  refreshBalance(): Promise<void>

  // ─── Cleanup (로그아웃용) ───
  readonly cleanup: {
    deleteCocoData(): Promise<void>
    clearWalletCache(): void
    clearMintData(mintUrl: string): Promise<void>
    resetWalletCache(): void
    deleteAllContacts(): Promise<void>
  }

  // ─── Exchange rate ───
  readonly exchangeRate: {
    loadCachedRates(): Promise<void>
    fetchRates(): void
    refreshIfStale(): Promise<void>
  }

  // ─── Routing (Phase 6에서 제거) ───
  executeRoute(selection: RouteSelection, context: RouteContext): Promise<RouteResult>

  // ─── Gift wrap watcher ───
  readonly giftWrapWatcher: GiftWrapWatcher

  // ─── P2PK, offline token ───
  readonly p2pkKeyManager: { getCurrentKey(): Promise<{ pubkey: string }> }
  storeOfflineToken(token: string, amount: number, mintUrl: string, dleqStatus: 'valid' | 'missing'): Promise<string>
}

// ─── Bootstrap ───

export function createBootstrap(deps: BootstrapDeps): BootstrapResult {
  // 1. Infrastructure
  const eventBus = createEventBus()
  const txRepo = new DexieTransactionRepository()
  const contactRepo = new DexieContactRepository()
  const pendingOpRepo = new DexiePendingOperationRepository()
  const operationMap = new DexieOperationMap()
  const failedIncomingStore = new FailedIncomingStoreAdapter()
  const processedStore = new ProcessedRepository()
  const settingsRepo = new SettingsRepository()

  // 2. Nostr Gateway
  const nostrGateway = new NostrGatewayAdapter({
    privateKeyHex: deps.nostrPrivateKeyHex,
  })

  // 3. Cashu Module (initialize()는 caller가 seed로 호출)
  const offlineTokenStore = new DexieOfflineTokenStore()
  const cashuBackend = createCashuBackend({ pendingOpRepo, txRepo, offlineTokenStore })
  const cashuModule = new CashuModule(cashuBackend, nostrGateway)
  const modules: WalletModule[] = [cashuModule]

  // 4. Non-module adapters
  const lnurlAdapter = new DirectLnurlAdapter()
  const nip05Adapter = new Nip05ResolverAdapter()
  const outgoingTransport = new NostrPaymentTransport(nostrGateway)

  // 5. Services (via composition roots)
  const payment = createPaymentService(modules, txRepo, eventBus, operationMap)
  const balance = createBalanceService(modules)
  const swap = createSwapService(modules, txRepo, eventBus)
  const contact = createContactService(contactRepo)
  const profile = createProfileService(nostrGateway, settingsRepo)
  const inputRouter = createInputRouter(lnurlAdapter)
  const addressResolver = createAddressResolver(nip05Adapter, nostrGateway, lnurlAdapter)

  // 6. P2PK key manager
  const p2pkKeyManager = new CocoP2PKKeyManager(async () => {
    const { getCocoManager } = await import('@/modules/cashu/internal/coco-sdk')
    return (await getCocoManager()).keyring
  })

  // 7. EventBus → Store bridge
  const balanceRefresh = async () => {
    const moduleBalances = await balance.getByModule()
    const byMint: Record<string, number> = {}
    let total = 0
    for (const mb of moduleBalances) {
      for (const account of mb.accounts) {
        byMint[account.id] = toNumber(account.amount)
        total += toNumber(account.amount)
      }
    }
    useAppStore.getState().setBalance({ total, byMint })
  }
  const disconnectBridge = connectEventStoreBridge(eventBus, {
    handleBalance: true,
    balanceRefresh,
  })

  // 8. Lifecycle: activate (Coco init + observers + watchers + bridge)
  const activate = async () => {
    const { getCocoManager, enableWatchers } = await import('@/modules/cashu/internal/coco-sdk')
    const manager = await getCocoManager()

    // mintQuoteObserver에 OperationMap + TxRepo 주입 (TX 이중 생성 방지)
    const { injectDependencies } = await import('@/composition/mint-quote-observer')
    injectDependencies(operationMap, txRepo)

    // Mint quote observer (mint-op:finalized → Transaction DB 기록)
    const { connectMintQuoteObserver } = await import('@/composition/mint-quote-observer')
    connectMintQuoteObserver(manager)

    // Send token observer 연결 (bootstrap과 동일 인스턴스 공유)
    const { connectSendTokenObserver } = await import('@/composition/send-token-observer')
    connectSendTokenObserver(manager, {
      operationMap,
      txRepo,
      pendingOps: pendingOpRepo,
    })

    // Coco → EventBus bridge
    connectCocoEventBridge(manager, eventBus)

    // Watchers
    await enableWatchers()
  }

  const onResume = async () => {
    try {
      const { getCocoManager, recheckPendingMintQuotes } = await import('@/modules/cashu/internal/coco-sdk')
      const manager = await getCocoManager()
      manager.resumeSubscriptions()
      recheckPendingMintQuotes().catch((e) => console.error('[Resume] recheck quotes failed:', e))
    } catch { /* ignore if not initialized */ }
    exchangeRateService.refreshIfStale().catch(() => {})
  }

  const onPause = async () => {
    try {
      const { getCocoManager } = await import('@/modules/cashu/internal/coco-sdk')
      const manager = await getCocoManager()
      manager.pauseSubscriptions()
    } catch { /* ignore if not initialized */ }
  }

  // 9. Additional services
  const recovery = createRecoveryService(nostrGateway, payment)
  const incomingPayment = new IncomingPaymentService(payment, processedStore, failedIncomingStore)
  const pendingItems = createPendingItemsService(txRepo)

  // 10. Gift wrap watcher
  const giftWrapWatcher = new GiftWrapWatcher({
    nostrGateway,
    incomingPayment,
    eventBus,
    recipientPubkey: derivePublicKey(deps.nostrPrivateKeyHex),
    getRelays: () => useAppStore.getState().settings.relays || [],
    getPosDevices: () => useAppStore.getState().settings.posDevices,
    getPendingRequestId: () => useAppStore.getState().pendingEcashRequestId,
  })

  // 11. WithdrawUseCase / LnurlAuthUseCase — TODO: NoOp impl or real impl
  // Phase 5에서는 undefined 허용하지 않으므로 placeholder
  const withdraw = {} as ServiceRegistry['withdraw']
  const lnurlAuth = {} as ServiceRegistry['lnurlAuth']

  // 12. Phase 6: New services
  const cryptoGateway = new CryptoGatewayAdapter()
  const crypto = new CryptoService(cryptoGateway)

  const tokenCodec = new TokenCodecAdapter()
  const inputParser = new InputParserService(tokenCodec, lnurlAdapter)

  const feeEstimator = new FeeEstimatorAdapter()
  const routing = new RoutingService(feeEstimator)

  const mintMetadataServiceInstance = new MintMetadataService(new DexieMintMetadataRepository())
  const mintMetadataStore = new MintMetadataStoreAdapter(mintMetadataServiceInstance, metadataEvents)
  const mintMetadata = new MintMetadataFacadeService(mintMetadataStore)

  const mintHealthChecker = new MintHealthCheckerAdapter()
  const mintHealth = new MintHealthFacadeService(mintHealthChecker)

  const sendTokenOperator = new SendTokenOperatorAdapter()
  const transactionMgmt = new TransactionMgmtService(txRepo, sendTokenOperator)

  const receiveRequestRepo = new DexieReceiveRequestRepository()
  const receiveRequest = new ReceiveRequestFacadeService(receiveRequestRepo)

  const paymentRequest = new PaymentRequestService(tokenCodec, (opts) => {
    const poller = startNut18HttpPoller({
      endpoint: opts.endpoint,
      requestId: opts.requestId,
      intervalMs: opts.intervalMs,
      maxDurationMs: opts.maxDurationMs,
    })
    return {
      stop: poller.cancel,
      onPayment: poller.onPayment,
      onError: poller.onError,
    }
  })

  const zappiLinkProvider = new ZappiLinkAdapter(
    (privateKeyHex, url, method) => {
      const event = finalizeEvent({
        kind: NOSTR_KINDS.NIP98_AUTH,
        content: '',
        tags: [['u', url], ['method', method.toUpperCase()]],
        created_at: Math.floor(Date.now() / 1000),
      }, hexToBytes(privateKeyHex))
      return btoa(JSON.stringify(event))
    },
  )
  const username = new UsernameService(zappiLinkProvider)

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
    transactionMgmt,
    inputParser,
    paymentRequest,
    routing,
    username,

    // ─── BootstrapResult extensions (MainApp only) ───
    cashuModule,
    operationMap,

    // Lifecycle
    activate,
    onResume,
    onPause,
    disconnectBridge,

    // Balance refresh (store 갱신 포함)
    refreshBalance: balanceRefresh,

    // Cleanup
    cleanup: {
      deleteCocoData,
      clearWalletCache: () => { /* no-op: cashu-ts wallet cache no longer used */ },
      clearMintData: (mintUrl: string) => clearMintData(mintUrl),
      resetWalletCache,
      deleteAllContacts: () => contactRepo.deleteAll(),
    },

    // Exchange rate
    exchangeRate: {
      loadCachedRates: () => exchangeRateService.loadCachedRates(),
      fetchRates: () => { exchangeRateService.fetchRates().catch(() => {}) },
      refreshIfStale: () => exchangeRateService.refreshIfStale(),
    },

    // Routing (Phase 6에서 제거)
    executeRoute: (selection: RouteSelection, context: RouteContext) =>
      legacyExecuteRoute(selection, { ...context, outgoingTransport }),

    // Gift wrap watcher
    giftWrapWatcher,

    // P2PK + offline token
    p2pkKeyManager,
    storeOfflineToken: (token: string, amount: number, mintUrl: string, dleqStatus: 'valid' | 'missing') =>
      cashuBackend.storeOfflineToken(token, amount, mintUrl, dleqStatus),
  }
}
