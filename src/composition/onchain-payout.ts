import {
  DEFAULT_CHAIN_API,
  EsploraChainClient,
  type PayoutChain,
} from '@/adapters/onchain-payout/electrum/chain-client'
import {
  DEFAULT_PAYOUT_RELAYS,
  createSimplePoolRelayClient,
  type PayoutRelayClient,
} from '@/adapters/onchain-payout/electrum/relay-client'
import { ElectrumPayoutProvider } from '@/adapters/onchain-payout/electrum/electrum-payout-provider'
import { DexieOnchainPayoutStore } from '@/adapters/storage/dexie/dexie-onchain-payout.store'
import type { EventBus } from '@/core/events/event-bus'
import type {
  OnchainPayoutProvider,
  OnchainPayoutQuote,
  OnchainPayoutStartResult,
} from '@/core/ports/driven/onchain-payout-provider.port'
import type { OnchainPayoutStore } from '@/core/ports/driven/onchain-payout-store.port'
import type { RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'
import type { OnchainPayoutStage } from '@/core/domain/onchain-payout'
import type { JsonValue } from '@/core/domain/json'
import type { OnchainPayoutProgress, OnchainPayoutAdvance } from '@/core/ports/driven/onchain-payout-provider.port'
import type { OnchainPayoutUseCase } from '@/core/ports/driving/onchain-payout.usecase'
import { OnchainPayoutService } from '@/core/services/onchain-payout.service'
import type { OnchainPayoutConfig } from './onchain-payout-config'

const STATUS_TIMEOUT_MS = 15_000

class LazyPayoutProvider implements OnchainPayoutProvider {
  readonly id = 'electrum'
  private provider: OnchainPayoutProvider | null = null
  private readonly build: () => OnchainPayoutProvider

  constructor(build: () => OnchainPayoutProvider) {
    this.build = build
  }

  private inner(): OnchainPayoutProvider {
    if (!this.provider) this.provider = this.build()
    return this.provider
  }

  quote(params: { sendAmount: number; destination: string }): Promise<OnchainPayoutQuote> {
    return this.inner().quote(params)
  }

  start(params: { quote: OnchainPayoutQuote }): Promise<OnchainPayoutStartResult> {
    return this.inner().start(params)
  }

  resume(params: {
    providerRef: JsonValue
    secrets: string
    stage: OnchainPayoutStage
    published: boolean
  }): Promise<OnchainPayoutAdvance> {
    return this.inner().resume(params)
  }

  publish(params: { providerRef: JsonValue; secrets: string }): Promise<OnchainPayoutProgress> {
    return this.inner().publish(params)
  }

  status(params: {
    providerRef: JsonValue
    stage: OnchainPayoutStage
    published: boolean
  }): Promise<OnchainPayoutProgress> {
    return this.inner().status(params)
  }
}

export type WipeableOnchainPayoutStore = OnchainPayoutStore & { wipe(): Promise<void> }

export interface OnchainPayoutBundle {
  service: OnchainPayoutUseCase
  store: WipeableOnchainPayoutStore
  dispose(): void
}

export interface CreateOnchainPayoutDeps {
  config: OnchainPayoutConfig
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
  store?: WipeableOnchainPayoutStore
}

export function createOnchainPayout(deps: CreateOnchainPayoutDeps): OnchainPayoutBundle {
  const { config, routePaymentOperator, eventBus } = deps
  const store = deps.store ?? new DexieOnchainPayoutStore()
  let relayClient: PayoutRelayClient | null = null

  const buildProvider = (): OnchainPayoutProvider => {
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

  const service = new OnchainPayoutService({
    provider: new LazyPayoutProvider(buildProvider),
    store,
    payments: routePaymentOperator,
    eventBus,
    enabled: () => config.enabled,
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    statusTimeoutMs: STATUS_TIMEOUT_MS,
    logger: { warn: (message) => console.warn('[OnchainPayout]', message) },
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
