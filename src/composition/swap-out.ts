import {
  DEFAULT_CHAIN_API,
  EsploraChainClient,
  type PayoutChain,
} from '@/adapters/swap-out/electrum/chain-client'
import {
  DEFAULT_PAYOUT_RELAYS,
  createSimplePoolRelayClient,
  type PayoutRelayClient,
} from '@/adapters/swap-out/electrum/relay-client'
import { ElectrumPayoutProvider } from '@/adapters/swap-out/electrum/electrum-payout-provider'
import { DexieSwapOutStore } from '@/adapters/storage/dexie/dexie-swap-out.store'
import type { EventBus } from '@/core/events/event-bus'
import type {
  SwapOutOffer,
  SwapOutProvider,
  SwapOutQuote,
  SwapOutStartResult,
} from '@/core/ports/driven/swap-out-provider.port'
import type { SwapOutStore } from '@/core/ports/driven/swap-out-store.port'
import type { RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { SwapOutStage } from '@/core/domain/swap-out'
import type { JsonValue } from '@/core/domain/json'
import type { SwapOutProgress, SwapOutAdvance } from '@/core/ports/driven/swap-out-provider.port'
import type { SwapOutUseCase } from '@/core/ports/driving/swap-out.usecase'
import { SwapOutService } from '@/core/services/swap-out.service'
import type { SwapOutConfig } from './swap-out-config'

const STATUS_TIMEOUT_MS = 15_000

class LazyPayoutProvider implements SwapOutProvider {
  readonly id = 'electrum'
  private provider: SwapOutProvider | null = null
  private readonly build: () => SwapOutProvider

  constructor(build: () => SwapOutProvider) {
    this.build = build
  }

  private inner(): SwapOutProvider {
    if (!this.provider) this.provider = this.build()
    return this.provider
  }

  listOffers(): Promise<SwapOutOffer[]> {
    return this.inner().listOffers()
  }

  quote(params: {
    offerId: string
    sendAmount: number
    destination: string
  }): Promise<SwapOutQuote> {
    return this.inner().quote(params)
  }

  start(params: { quote: SwapOutQuote }): Promise<SwapOutStartResult> {
    return this.inner().start(params)
  }

  resume(params: {
    providerRef: JsonValue
    secrets: string
    stage: SwapOutStage
    published: boolean
  }): Promise<SwapOutAdvance> {
    return this.inner().resume(params)
  }

  publish(params: { providerRef: JsonValue; secrets: string }): Promise<SwapOutProgress> {
    return this.inner().publish(params)
  }

  status(params: {
    providerRef: JsonValue
    stage: SwapOutStage
    published: boolean
  }): Promise<SwapOutProgress> {
    return this.inner().status(params)
  }
}

export type WipeableSwapOutStore = SwapOutStore & { wipe(): Promise<void> }

export interface SwapOutBundle {
  service: SwapOutUseCase
  store: WipeableSwapOutStore
  dispose(): void
}

export interface CreateSwapOutDeps {
  config: SwapOutConfig
  routePaymentOperator: Pick<
    RoutePaymentOperator,
    | 'prepareMelt'
    | 'executeMelt'
    | 'rollbackMelt'
    | 'refreshMelt'
    | 'checkMeltSettlement'
    | 'heldAmounts'
  >
  eventBus: EventBus
  txRepo: Pick<TransactionRepository, 'save' | 'getById' | 'update'>
  store?: WipeableSwapOutStore
}

export function createSwapOut(deps: CreateSwapOutDeps): SwapOutBundle {
  const { config, routePaymentOperator, eventBus, txRepo } = deps
  const store = deps.store ?? new DexieSwapOutStore()
  let relayClient: PayoutRelayClient | null = null

  const buildProvider = (): SwapOutProvider => {
    const chain: PayoutChain = new EsploraChainClient({
      baseUrl: config.chainApiUrl ?? DEFAULT_CHAIN_API[config.network] ?? '',
    })
    relayClient = createSimplePoolRelayClient()
    return new ElectrumPayoutProvider({
      network: config.network,
      relayClient,
      chain,
      relays: config.relays ?? DEFAULT_PAYOUT_RELAYS,
      appLimits: { minAmount: config.minAmount, maxAmount: config.maxAmount },
      powTargetBits: config.powTargetBits,
    })
  }

  const service = new SwapOutService({
    provider: new LazyPayoutProvider(buildProvider),
    store,
    payments: routePaymentOperator,
    txRepo,
    eventBus,
    enabled: () => config.enabled,
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    statusTimeoutMs: STATUS_TIMEOUT_MS,
    logger: { warn: (message) => console.warn('[SwapOut]', message) },
  })

  return {
    service,
    store,
    dispose() {
      relayClient?.close()
      relayClient = null
    },
  }
}
