import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '@/core/events/domain-events'
import type { EventBus } from '@/core/events/event-bus'
import {
  OnchainPayoutAmountOutOfRangeError,
  OnchainPayoutOfferUnavailableError,
  OnchainPayoutProviderRejectedError,
  OnchainPayoutQuoteExpiredError,
  OnchainPayoutUnavailableError,
} from '@/core/errors/onchain-payout'
import type {
  OnchainPayoutAdvance,
  OnchainPayoutOffer,
  OnchainPayoutProvider,
  OnchainPayoutQuote,
  OnchainPayoutStartResult,
} from '@/core/ports/driven/onchain-payout-provider.port'
import type {
  OnchainPayoutRecord,
  OnchainPayoutStore,
  OnchainPayoutUpdate,
} from '@/core/ports/driven/onchain-payout-store.port'
import type {
  ExecutedRouteMelt,
  RoutePaymentOperator,
} from '@/core/ports/driven/route-payment-operator.port'
import { OnchainPayoutService } from '@/core/services/onchain-payout.service'
import { isPayoutStageTerminal } from '@/core/domain/onchain-payout'
import { InsufficientBalanceError } from '@/core/errors/payment.errors'

const NOW = 1_700_000_000_000
const MINT = 'https://mint.example.com'

type Payments = Pick<
  RoutePaymentOperator,
  | 'prepareMelt'
  | 'executeMelt'
  | 'rollbackMelt'
  | 'refreshMelt'
  | 'checkMeltSettlement'
  | 'heldAmounts'
>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

const OFFER_ID = 'fake:offer-1'

function makeOffer(patch: Partial<OnchainPayoutOffer> = {}): OnchainPayoutOffer {
  return {
    offerId: OFFER_ID,
    identifier: 'npub1fake',
    feePercent: 0.3,
    networkFee: 700,
    payoutFeeRate: 2,
    payoutFeeEstimate: 272,
    minAmount: 20000,
    maxAmount: 2000000,
    seenAt: NOW,
    ...patch,
  }
}

function makeQuote(patch: Partial<OnchainPayoutQuote> = {}): OnchainPayoutQuote {
  return {
    providerId: 'fake',
    offerId: OFFER_ID,
    identifier: 'npub1fake',
    destination: 'bcrt1qdestination',
    sendAmount: 100000,
    receiveAmount: 99000,
    serviceFee: 300,
    networkFee: 700,
    sweepFee: 500,
    limits: { minAmount: 20000, maxAmount: 2000000 },
    estimatedMinutes: 1,
    offerRef: { pubkey: 'server' },
    expiresAt: NOW + 60000,
    ...patch,
  }
}

function makeStartResult(patch: Partial<OnchainPayoutStartResult> = {}): OnchainPayoutStartResult {
  return {
    providerRef: { v: 1, serverId: 'server-1' },
    secrets: 'secrets-1',
    paymentRequests: [
      { request: 'fee', amount: 45000 },
      { request: 'main', amount: 55000 },
    ],
    sendAmount: 100000,
    receiveAmount: 99000,
    deadline: { blockHeight: 209, estimatedAt: NOW + 4800000 },
    ...patch,
  }
}

function makeRecord(patch: Partial<OnchainPayoutRecord> = {}): OnchainPayoutRecord {
  return {
    id: 'payout-1',
    version: 1,
    providerId: 'fake',
    mintUrl: MINT,
    destination: 'bcrt1qdestination',
    sendAmount: 100000,
    receiveAmount: 99000,
    stage: 'funded',
    phase: 'in_transit',
    providerRef: { v: 1, serverId: 'server-1' },
    payments: [
      {
        request: 'fee',
        amount: 45000,
        operationId: 'op-fee',
        feeReserve: 42,
        status: 'dispatched',
        feePaid: null,
        settledAt: null,
      },
      {
        request: 'main',
        amount: 55000,
        operationId: 'op-main',
        feeReserve: 42,
        status: 'dispatched',
        feePaid: null,
        settledAt: null,
      },
    ],
    payoutTxId: null,
    failureReason: null,
    publishedAt: null,
    deadline: { blockHeight: 209, estimatedAt: NOW + 4800000 },
    createdAt: 100,
    updatedAt: 100,
    ...patch,
  }
}

class FakeStore implements OnchainPayoutStore {
  records = new Map<string, OnchainPayoutRecord>()
  secrets = new Map<string, string>()
  failUpdates = 0
  beforeUpdate: ((changes: OnchainPayoutUpdate) => boolean) | null = null
  afterUpdate: ((changes: OnchainPayoutUpdate) => void) | null = null
  onCreate: (() => Promise<void>) | null = null

  constructor(private readonly timeline: string[]) {}

  seed(record: OnchainPayoutRecord, secrets = 'secrets-1'): void {
    this.records.set(record.id, clone(record))
    this.secrets.set(record.id, secrets)
  }

  async create(record: OnchainPayoutRecord, secrets: string): Promise<void> {
    this.timeline.push(`store:create:${record.id}`)
    this.records.set(record.id, clone(record))
    this.secrets.set(record.id, secrets)
    await this.onCreate?.()
  }

  async get(id: string): Promise<OnchainPayoutRecord | null> {
    const record = this.records.get(id)
    return record ? clone(record) : null
  }

  async update(
    id: string,
    expectedVersion: number,
    changes: OnchainPayoutUpdate,
  ): Promise<boolean> {
    if (changes.secrets !== undefined) this.timeline.push('store:update:secrets')
    if (changes.publishedAt !== undefined) this.timeline.push('store:update:published')
    if (changes.stage !== undefined) this.timeline.push(`store:update:stage:${changes.stage}`)
    const current = this.records.get(id)
    if (!current || current.version !== expectedVersion) return false
    if (this.failUpdates > 0) {
      this.failUpdates -= 1
      return false
    }
    if (this.beforeUpdate && !this.beforeUpdate(changes)) return false
    const { secrets, ...rest } = changes
    const next = { ...current, ...rest, version: current.version + 1 }
    this.records.set(id, clone(next))
    if (secrets !== undefined) this.secrets.set(id, secrets)
    this.afterUpdate?.(changes)
    return true
  }

  async readSecrets(id: string): Promise<string | null> {
    return this.secrets.get(id) ?? null
  }

  async listActive(): Promise<OnchainPayoutRecord[]> {
    return [...this.records.values()]
      .map(clone)
      .filter(
        (record) =>
          !isPayoutStageTerminal(record.stage) ||
          record.payments.some(
            (payment) => payment.status === 'prepared' || payment.status === 'dispatched',
          ),
      )
  }

  async list(): Promise<OnchainPayoutRecord[]> {
    return [...this.records.values()].map(clone)
  }
}

interface ProviderControl {
  offers?: OnchainPayoutOffer[]
  listOffersError?: unknown
  quote?: OnchainPayoutQuote
  start?: OnchainPayoutStartResult
  resume?: OnchainPayoutAdvance
  startError?: unknown
  quoteError?: unknown
  resumeError?: unknown
  onResume?: () => void
}

function createProvider(control: ProviderControl, timeline: string[]) {
  const calls: string[] = []
  const provider: OnchainPayoutProvider = {
    id: 'fake',
    async listOffers() {
      calls.push('listOffers')
      if (control.listOffersError) throw control.listOffersError
      return control.offers ?? [makeOffer()]
    },
    async quote() {
      calls.push('quote')
      if (control.quoteError) throw control.quoteError
      return control.quote ?? makeQuote()
    },
    async start() {
      calls.push('start')
      if (control.startError) throw control.startError
      return control.start ?? makeStartResult()
    },
    async resume() {
      calls.push('resume')
      control.onResume?.()
      if (control.resumeError) throw control.resumeError
      return control.resume ?? { progress: { stage: 'funded' } }
    },
    async publish() {
      calls.push('publish')
      timeline.push('provider:publish')
      return { stage: 'sweeping' }
    },
    async status() {
      calls.push('status')
      return { stage: 'funded' }
    },
  }
  return { provider, calls }
}

interface PaymentControl {
  prepareFailIndex?: number
  refreshStates?: string[]
  hangFirstRefresh?: boolean
  rollbackFailCount?: number
  onPrepare?: (request: string) => void
  held?: Record<string, number>
  heldError?: boolean
  settlementStates?: string[]
  hangSettlement?: boolean
  settlementError?: boolean
  onSettlementCheck?: () => void
}

function createPayments(control: PaymentControl, timeline: string[]) {
  const order: string[] = []
  const rollbacks: string[] = []
  const refreshes: string[] = []
  const settlements: string[] = []
  const heldCalls: { mintUrl: string; operationIds: string[] }[] = []
  const pending: {
    operationId: string
    resolve: (result: ExecutedRouteMelt) => void
    reject: (error: unknown) => void
  }[] = []
  let refreshIndex = 0
  let settlementIndex = 0

  const payments: Payments = {
    async prepareMelt(_mintUrl, request) {
      order.push(`prepare:${request}`)
      timeline.push(`prepare:${request}`)
      const prepareCount = order.filter((entry) => entry.startsWith('prepare:')).length - 1
      if (control.prepareFailIndex === prepareCount) {
        throw new InsufficientBalanceError(100000, 10)
      }
      control.onPrepare?.(request)
      return {
        operationId: `op-${request}`,
        quoteId: `quote-${request}`,
        amount: 0,
        feeReserve: 42,
        swapFee: 0,
      }
    },
    executeMelt(operationId) {
      order.push(`execute:${operationId}`)
      timeline.push(`execute:${operationId}`)
      return new Promise<ExecutedRouteMelt>((resolve, reject) => {
        pending.push({ operationId, resolve, reject })
      })
    },
    async rollbackMelt(operationId) {
      order.push(`rollback:${operationId}`)
      if ((control.rollbackFailCount ?? 0) > 0) {
        control.rollbackFailCount = (control.rollbackFailCount ?? 0) - 1
        throw new Error('rollback unavailable')
      }
      rollbacks.push(operationId)
    },
    async heldAmounts(mintUrl: string, operationIds: string[]) {
      heldCalls.push({ mintUrl, operationIds })
      if (control.heldError) throw new Error('proof store down')
      return Object.fromEntries(
        operationIds.map((operationId) => [operationId, control.held?.[operationId] ?? 0]),
      )
    },
    async checkMeltSettlement(operationId: string) {
      settlements.push(operationId)
      control.onSettlementCheck?.()
      if (control.settlementError) throw new Error('mint unreachable')
      if (control.hangSettlement) {
        control.hangSettlement = false
        return new Promise<{ state: string }>(() => {})
      }
      const state = control.settlementStates?.[settlementIndex] ?? 'pending'
      settlementIndex += 1
      return { state }
    },
    async refreshMelt(operationId: string) {
      refreshes.push(operationId)
      if (control.hangFirstRefresh) {
        control.hangFirstRefresh = false
        return new Promise<{ state: string }>(() => {})
      }
      const state = control.refreshStates?.[refreshIndex] ?? 'pending'
      refreshIndex += 1
      return { state }
    },
  }
  return { payments, order, rollbacks, refreshes, settlements, heldCalls, pending }
}

function setup(
  options: {
    enabled?: boolean
    statusTimeoutMs?: number
    prepareFailIndex?: number
    refreshStates?: string[]
    hangFirstRefresh?: boolean
    settlementStates?: string[]
    hangSettlement?: boolean
    settlementError?: boolean
  } = {},
) {
  const timeline: string[] = []
  const store = new FakeStore(timeline)
  const control: ProviderControl = {}
  const providerKit = createProvider(control, timeline)
  const paymentControl: PaymentControl = {
    prepareFailIndex: options.prepareFailIndex,
    refreshStates: options.refreshStates,
    hangFirstRefresh: options.hangFirstRefresh,
    settlementStates: options.settlementStates,
    hangSettlement: options.hangSettlement,
    settlementError: options.settlementError,
  }
  const paymentKit = createPayments(paymentControl, timeline)
  const events: DomainEvent[] = []
  const eventBus: EventBus = {
    emit: (event) => {
      events.push(event)
    },
    on: () => () => {},
    off: () => {},
  }
  const clock = { now: NOW }
  let counter = 0
  const service = new OnchainPayoutService({
    provider: providerKit.provider,
    store,
    payments: paymentKit.payments,
    eventBus,
    enabled: () => options.enabled ?? true,
    now: () => clock.now,
    newId: () => `id-${++counter}`,
    statusTimeoutMs: options.statusTimeoutMs ?? 50,
    logger: { warn: () => {} },
  })
  return {
    service,
    store,
    control,
    paymentControl,
    ...providerKit,
    ...paymentKit,
    timeline,
    events,
    clock,
  }
}

async function quoteAndStart(service: OnchainPayoutService) {
  const quoted = await service.quote({
    offerId: OFFER_ID,
    sendAmount: 100000,
    destination: 'bcrt1qdestination',
    mintUrl: MINT,
  })
  if (!quoted.ok) throw new Error('quote failed')
  return service.start({ quoteId: quoted.value.quoteId, mintUrl: MINT })
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function openRecord(patch: Partial<OnchainPayoutRecord> = {}): OnchainPayoutRecord {
  return makeRecord({
    stage: 'funded',
    payments: [
      { request: 'fee', amount: 45000, operationId: 'op-fee', feeReserve: 500, status: 'dispatched', feePaid: null, settledAt: null },
      { request: 'main', amount: 55000, operationId: 'op-main', feeReserve: 500, status: 'dispatched', feePaid: null, settledAt: null },
    ],
    ...patch,
  })
}

describe('onchain payout service start', () => {
  it('persists secrets before the first payment is prepared', async () => {
    const { service, store, timeline, events } = setup()
    const started = await quoteAndStart(service)
    expect(started.ok).toBe(true)
    expect(store.records.get('id-2')).toMatchObject({
      offerId: OFFER_ID,
      identifier: 'npub1fake',
    })
    const createIndex = timeline.indexOf('store:create:id-2')
    const firstPrepare = timeline.findIndex((entry) => entry.startsWith('prepare:'))
    expect(createIndex).toBeGreaterThan(-1)
    expect(createIndex).toBeLessThan(firstPrepare)
    expect(events[0].type).toBe('onchain-payout:updated')
  })

  it('dispatches both payments concurrently before start resolves', async () => {
    const { service, order, pending } = setup()
    const started = await quoteAndStart(service)
    expect(started.ok && started.value.stage).toBe('paying')
    expect(order.filter((entry) => entry.startsWith('execute:'))).toEqual([
      'execute:op-fee',
      'execute:op-main',
    ])
    expect(pending).toHaveLength(2)
    pending[0].resolve({ secret: 'aa' })
    pending[1].reject(new Error('aborted'))
    await flush()
  })

  it('keeps a payment dispatched when its melt call fails', async () => {
    const { service, store, pending, rollbacks } = setup()
    await quoteAndStart(service)
    pending[0].reject(new Error('fetch failed after 600s'))
    pending[1].reject(new Error('fetch failed after 600s'))
    await flush()
    expect(rollbacks).toEqual([])
    const record = store.records.get('id-2')
    expect(record?.payments.map((payment) => payment.status)).toEqual([
      'dispatched',
      'dispatched',
    ])
  })

  it('aborts and rolls back everything when saving an operation id fails', async () => {
    const { service, store, rollbacks, order } = setup()
    store.beforeUpdate = (changes) =>
      !(
        changes.payments?.some(
          (payment) => payment.request === 'main' && payment.operationId === 'op-main',
        ) ?? false
      )
    const started = await quoteAndStart(service)
    expect(started.ok).toBe(false)
    expect(rollbacks).toEqual(['op-fee', 'op-main'])
    expect(order.filter((entry) => entry.startsWith('execute:'))).toEqual([])
    const record = store.records.get('id-2')
    expect(record?.stage).toBe('aborted')
    expect(record?.failureReason).toBe('prepare_failed')
    expect(record?.payments.map((payment) => payment.status)).toEqual([
      'rolled_back',
      'rolled_back',
    ])
  })

  it('refuses to dispatch when the record left the quoted stage during prepare', async () => {
    const { service, store, rollbacks, order } = setup()
    store.afterUpdate = (changes) => {
      const storedMainOperation =
        changes.payments?.some(
          (payment) => payment.request === 'main' && payment.operationId === 'op-main',
        ) ?? false
      if (!storedMainOperation) return
      const current = store.records.get('id-2')
      if (current) store.records.set('id-2', { ...current, stage: 'aborted' })
    }
    const started = await quoteAndStart(service)
    expect(started.ok).toBe(false)
    expect(!started.ok && started.error).toBeInstanceOf(OnchainPayoutProviderRejectedError)
    expect(order.filter((entry) => entry.startsWith('execute:'))).toEqual([])
    expect(rollbacks).toEqual(['op-fee', 'op-main'])
    expect(store.records.get('id-2')?.stage).toBe('aborted')
  })

  it('skips a record that is still being created', async () => {
    const { service, store, rollbacks } = setup()
    let resumed: Promise<void> | null = null
    store.onCreate = async () => {
      resumed = service.resumeAll()
      await resumed
    }
    const started = await quoteAndStart(service)
    expect(resumed).not.toBeNull()
    expect(rollbacks).toEqual([])
    expect(started.ok).toBe(true)
    expect(store.records.get('id-2')?.stage).toBe('paying')
  })

  it('does not record an operation id on a record that left the quoted stage', async () => {
    const { service, store, rollbacks, paymentControl } = setup()
    paymentControl.onPrepare = () => {
      const current = store.records.get('id-2')
      if (current) store.records.set('id-2', { ...current, stage: 'aborted' })
    }
    const started = await quoteAndStart(service)
    expect(started.ok).toBe(false)
    expect(rollbacks).toEqual(['op-fee'])
    expect(store.records.get('id-2')?.payments.map((payment) => payment.operationId)).toEqual([
      null,
      null,
    ])
  })

  it('skips a record that start() is still preparing', async () => {
    const { service, store, rollbacks, paymentControl } = setup()
    let resumed: Promise<void> | null = null
    paymentControl.onPrepare = (request) => {
      if (request === 'fee') resumed = service.resumeAll()
    }
    const started = await quoteAndStart(service)
    await resumed
    expect(rollbacks).toEqual([])
    expect(started.ok).toBe(true)
    expect(store.records.get('id-2')?.stage).toBe('paying')
  })

  it('clears the reservation after a failed prepare', async () => {
    const { service, store } = setup({ prepareFailIndex: 1 })
    const started = await quoteAndStart(service)
    expect(started.ok).toBe(false)
    expect(store.records.get('id-2')?.payments.map((payment) => payment.status)).toEqual([
      'rolled_back',
      'rolled_back',
    ])
    expect(await service.inFlightAmount()).toBe(0)
    expect(await service.listActive()).toEqual([])
  })

  it('keeps a payout open after a failed rollback and retries it on the next resume', async () => {
    const { service, store, paymentControl } = setup({ prepareFailIndex: 1 })
    paymentControl.rollbackFailCount = 1
    const started = await quoteAndStart(service)
    expect(started.ok).toBe(false)
    expect(store.records.get('id-2')?.payments.map((payment) => payment.status)).toEqual([
      'prepared',
      'rolled_back',
    ])
    expect((await service.listActive()).map((view) => view.id)).toEqual(['id-2'])
    await service.resumeAll()
    expect(store.records.get('id-2')?.payments.map((payment) => payment.status)).toEqual([
      'rolled_back',
      'rolled_back',
    ])
    expect(await service.inFlightAmount()).toBe(0)
    expect(await service.listActive()).toEqual([])
  })

  it('rolls back prepared payments and aborts when a prepare fails', async () => {
    const { service, store, rollbacks } = setup({ prepareFailIndex: 1 })
    const started = await quoteAndStart(service)
    expect(started.ok).toBe(false)
    expect(!started.ok && started.error).toBeInstanceOf(InsufficientBalanceError)
    expect(rollbacks).toEqual(['op-fee'])
    const record = store.records.get('id-2')
    expect(record?.stage).toBe('aborted')
    expect(record?.failureReason).toBe('prepare_failed')
  })
})

describe('onchain payout service offers', () => {
  it('lists the provider offers when enabled', async () => {
    const { service, control, calls } = setup()
    control.offers = [makeOffer({ offerId: 'b', feePercent: 0.5 }), makeOffer({ offerId: 'a' })]
    const result = await service.listOffers()
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.map((offer) => offer.offerId)).toEqual(['b', 'a'])
    expect(calls).toEqual(['listOffers'])
  })

  it('reports unavailability when disabled', async () => {
    const { service, calls } = setup({ enabled: false })
    const result = await service.listOffers()
    expect(!result.ok && result.error).toBeInstanceOf(OnchainPayoutUnavailableError)
    expect(calls).toEqual([])
  })

  it('passes a provider failure through', async () => {
    const { service, control } = setup()
    control.listOffersError = new OnchainPayoutUnavailableError('no provider')
    const result = await service.listOffers()
    expect(!result.ok && result.error).toBeInstanceOf(OnchainPayoutUnavailableError)
  })

  it('wraps an unknown provider failure', async () => {
    const { service, control } = setup()
    control.listOffersError = new Error('relay down')
    const result = await service.listOffers()
    expect(!result.ok && result.error).toBeInstanceOf(OnchainPayoutUnavailableError)
  })
})

describe('onchain payout service quote', () => {
  it('reports unavailability when disabled', async () => {
    const { service } = setup({ enabled: false })
    const result = await service.quote({
      offerId: OFFER_ID,
      sendAmount: 100000,
      destination: 'bcrt1qdestination',
      mintUrl: MINT,
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toBeInstanceOf(OnchainPayoutUnavailableError)
  })

  it('requires a chosen offer', async () => {
    const { service } = setup()
    const result = await service.quote({
      sendAmount: 100000,
      destination: 'bcrt1qdestination',
      mintUrl: MINT,
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toBeInstanceOf(OnchainPayoutOfferUnavailableError)
  })

  it('rejects a non-positive amount', async () => {
    const { service } = setup()
    const result = await service.quote({
      offerId: OFFER_ID,
      sendAmount: 0,
      destination: 'bcrt1qdestination',
      mintUrl: MINT,
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toBeInstanceOf(OnchainPayoutAmountOutOfRangeError)
  })

  it('passes provider errors through', async () => {
    const { service, control } = setup()
    control.quoteError = new OnchainPayoutUnavailableError('no provider')
    const result = await service.quote({
      offerId: OFFER_ID,
      sendAmount: 100000,
      destination: 'bcrt1qdestination',
      mintUrl: MINT,
    })
    expect(!result.ok && result.error).toBeInstanceOf(OnchainPayoutUnavailableError)
  })

  it('expires quotes, rejects a mint mismatch and allows a single start', async () => {
    const { service, clock } = setup()
    const quoted = await service.quote({
      offerId: OFFER_ID,
      sendAmount: 100000,
      destination: 'bcrt1qdestination',
      mintUrl: MINT,
    })
    if (!quoted.ok) throw new Error('quote failed')
    expect(quoted.value.offerId).toBe(OFFER_ID)
    expect(quoted.value.identifier).toBe('npub1fake')
    const mismatch = await service.start({
      quoteId: quoted.value.quoteId,
      mintUrl: 'https://other.example.com',
    })
    expect(!mismatch.ok && mismatch.error).toBeInstanceOf(OnchainPayoutQuoteExpiredError)

    const second = await service.quote({
      offerId: OFFER_ID,
      sendAmount: 100000,
      destination: 'bcrt1qdestination',
      mintUrl: MINT,
    })
    if (!second.ok) throw new Error('quote failed')
    clock.now = second.value.expiresAt + 1
    const expired = await service.start({
      quoteId: second.value.quoteId,
      mintUrl: MINT,
    })
    expect(!expired.ok && expired.error).toBeInstanceOf(OnchainPayoutQuoteExpiredError)
  })

  it('rejects inconsistent provider amounts', async () => {
    const { service, control } = setup()
    control.start = makeStartResult({ receiveAmount: 1 })
    const started = await quoteAndStart(service)
    expect(!started.ok && started.error).toBeInstanceOf(OnchainPayoutProviderRejectedError)
  })
})

describe('onchain payout service resume', () => {
  it('rolls back an interrupted pre-dispatch record', async () => {
    const { service, store, rollbacks } = setup()
    store.seed(
      makeRecord({
        stage: 'quoted',
        phase: 'preparing',
        payments: makeRecord().payments.map((payment) => ({
          ...payment,
          status: 'prepared' as const,
        })),
      }),
    )
    await service.resumeAll()
    expect(rollbacks).toEqual(['op-fee', 'op-main'])
    const record = store.records.get('payout-1')
    expect(record?.stage).toBe('aborted')
    expect(record?.failureReason).toBe('interrupted_before_payment')
  })

  it('does not abort a record that was dispatched while it was being resumed', async () => {
    const { service, store, rollbacks } = setup()
    store.seed(
      makeRecord({
        stage: 'quoted',
        phase: 'preparing',
        payments: makeRecord().payments.map((payment) => ({
          ...payment,
          status: 'prepared' as const,
        })),
      }),
    )
    let flipped = false
    store.beforeUpdate = () => {
      if (!flipped) {
        flipped = true
        const current = store.records.get('payout-1')
        if (current) store.records.set('payout-1', { ...current, stage: 'paying' })
      }
      return false
    }
    await service.resumeAll()
    expect(rollbacks).toEqual([])
    expect(store.records.get('payout-1')?.stage).toBe('paying')
    expect(store.records.get('payout-1')?.failureReason).toBeNull()
  })

  it('clears a stale failure reason on a later progress update', async () => {
    const { service, store, control } = setup()
    store.seed(makeRecord({ stage: 'funded', failureReason: 'fee_too_high' }))
    await service.resumeAll()
    expect(store.records.get('payout-1')?.failureReason).toBeNull()

    control.resume = { progress: { stage: 'funded', failureReason: 'too_close_to_locktime' } }
    await service.resumeAll()
    expect(store.records.get('payout-1')?.failureReason).toBe('too_close_to_locktime')
  })

  it('persists a prepared sweep and its publication before publishing', async () => {
    const { service, store, control, timeline } = setup()
    store.seed(makeRecord({ stage: 'funded', publishedAt: null }))
    control.resume = {
      progress: { stage: 'sweeping', payoutTxId: 'tx-1' },
      prepared: { secrets: 'secrets-2', payoutTxId: 'tx-1' },
    }
    await service.resumeAll()
    const publishIndex = timeline.indexOf('provider:publish')
    expect(publishIndex).toBeGreaterThan(-1)
    expect(timeline.indexOf('store:update:secrets')).toBeLessThan(publishIndex)
    expect(timeline.indexOf('store:update:published')).toBeLessThan(publishIndex)
    const record = store.records.get('payout-1')
    expect(record?.stage).toBe('sweeping')
    expect(record?.payoutTxId).toBe('tx-1')
    expect(record?.publishedAt).toBe(NOW)
    expect(await store.readSecrets('payout-1')).toBe('secrets-2')
  })

  it('never publishes when the secrets update fails', async () => {
    const { service, store, control, calls } = setup()
    store.seed(makeRecord({ stage: 'funded', publishedAt: null }))
    control.resume = {
      progress: { stage: 'sweeping' },
      prepared: { secrets: 'secrets-2', payoutTxId: 'tx-1' },
    }
    store.failUpdates = 100
    await service.resumeAll()
    expect(calls).not.toContain('publish')
    expect(store.records.get('payout-1')?.stage).toBe('funded')
  })

  it('rebroadcasts a published sweep and skips an unpublished one', async () => {
    const { service, store, control, calls } = setup()
    store.seed(makeRecord({ id: 'published', stage: 'sweeping', publishedAt: NOW }))
    store.seed(makeRecord({ id: 'unpublished', stage: 'sweeping', publishedAt: null }))
    control.resume = {
      progress: { stage: 'funded', failureReason: 'too_close_to_locktime' },
    }
    await service.resumeAll()
    expect(calls.filter((call) => call === 'publish')).toHaveLength(0)

    control.resume = { progress: { stage: 'sweeping', payoutTxId: 'tx-1' } }
    await service.resumeAll()
    expect(calls.filter((call) => call === 'publish')).toHaveLength(1)
  })

  it('marks payments paid after completion and retries a hanging refresh', async () => {
    const { service, store, pending } = setup({ hangFirstRefresh: true })
    pending.length = 0
    store.seed(
      makeRecord({
        stage: 'completed',
        phase: 'settled',
        payments: makeRecord().payments.map((payment) => ({
          ...payment,
          status: 'dispatched' as const,
        })),
      }),
    )
    await service.resumeAll()
    expect(store.records.get('payout-1')?.payments[0].status).toBe('dispatched')

    const second = setup({ refreshStates: ['finalized', 'finalized'] })
    second.store.seed(
      makeRecord({
        stage: 'completed',
        phase: 'settled',
        payments: makeRecord().payments.map((payment) => ({
          ...payment,
          status: 'dispatched' as const,
        })),
      }),
    )
    await second.service.resumeAll()
    expect(second.store.records.get('payout-1')?.payments.map((payment) => payment.status)).toEqual([
      'paid',
      'paid',
    ])
  })

  it('reconciles a refunded payout without rolling back pending payments', async () => {
    const pendingKit = setup({ refreshStates: ['pending', 'pending'] })
    pendingKit.store.seed(makeRecord({ stage: 'refunded', phase: 'failed' }))
    await pendingKit.service.resumeAll()
    expect(pendingKit.rollbacks).toEqual([])
    expect(pendingKit.store.records.get('payout-1')?.payments[0].status).toBe('dispatched')

    const refundedKit = setup({ refreshStates: ['rolled_back', 'prepared'] })
    refundedKit.store.seed(makeRecord({ stage: 'refunded', phase: 'failed' }))
    await refundedKit.service.resumeAll()
    expect(refundedKit.rollbacks).toEqual(['op-main'])
    expect(
      refundedKit.store.records.get('payout-1')?.payments.map((payment) => payment.status),
    ).toEqual(['rolled_back', 'rolled_back'])
  })

  it('rolls back a dispatched-but-never-sent payment on a terminal record', async () => {
    const { service, store, control, rollbacks } = setup({
      refreshStates: ['prepared', 'prepared'],
    })
    store.seed(makeRecord({ stage: 'paying' }))
    control.resume = { progress: { stage: 'aborted', failureReason: 'expired' } }
    await service.resumeAll()
    expect(rollbacks).toEqual(['op-fee', 'op-main'])
    expect(
      store.records.get('payout-1')?.payments.map((payment) => payment.status),
    ).toEqual(['rolled_back', 'rolled_back'])
    expect(await service.inFlightAmount()).toBe(0)
  })

  it('marks rolled-back payments on a completed payout', async () => {
    const { service, store } = setup({ refreshStates: ['rolled_back', 'finalized'] })
    store.seed(
      makeRecord({
        stage: 'completed',
        phase: 'settled',
        payments: makeRecord().payments.map((payment) => ({
          ...payment,
          status: 'dispatched' as const,
        })),
      }),
    )
    await service.resumeAll()
    expect(
      store.records.get('payout-1')?.payments.map((payment) => payment.status),
    ).toEqual(['rolled_back', 'paid'])
  })

  it('skips the pass when the record version moved after resume', async () => {
    const { service, store, control, calls } = setup()
    store.seed(makeRecord({ stage: 'funded', publishedAt: null }))
    control.resume = {
      progress: { stage: 'sweeping', payoutTxId: 'tx-1' },
      prepared: { secrets: 'secrets-2', payoutTxId: 'tx-1' },
    }
    control.onResume = () => {
      const current = store.records.get('payout-1')
      if (current) store.records.set('payout-1', { ...current, version: current.version + 1 })
    }
    await service.resumeAll()
    expect(calls).not.toContain('publish')
    expect(store.records.get('payout-1')?.stage).toBe('funded')
    expect(await store.readSecrets('payout-1')).toBe('secrets-1')
  })

  it('skips reconciliation for melts still executing in this process', async () => {
    const { service, store, control, pending, refreshes } = setup({
      refreshStates: ['finalized', 'finalized'],
    })
    await quoteAndStart(service)
    control.resume = { progress: { stage: 'completed' } }
    await service.resumeAll()
    expect(refreshes).toEqual([])
    expect(store.records.get('id-2')?.stage).toBe('completed')
    expect(store.records.get('id-2')?.payments.map((payment) => payment.status)).toEqual([
      'dispatched',
      'dispatched',
    ])
    pending[0].resolve({ secret: 'aa' })
    pending[1].resolve({ secret: 'bb' })
    await flush()
    expect(store.records.get('id-2')?.payments.map((payment) => payment.status)).toEqual([
      'paid',
      'paid',
    ])
  })

  it('marks a dispatched payment paid once its melt settled before the sweep confirmed', async () => {
    const { service, store } = setup({ settlementStates: ['finalized', 'finalized'] })
    store.seed(makeRecord({ stage: 'sweeping', publishedAt: NOW }))
    await service.resumeAll()
    expect(store.records.get('payout-1')?.payments.map((payment) => payment.status)).toEqual([
      'paid',
      'paid',
    ])
    expect(await service.inFlightAmount()).toBe(0)
  })

  it('never checks a payment whose execute call is still in flight', async () => {
    const { service, store, pending, settlements } = setup({
      settlementStates: ['finalized', 'finalized'],
    })
    await quoteAndStart(service)
    await service.resumeAll()
    expect(settlements).toEqual([])
    expect(store.records.get('id-2')?.payments.map((payment) => payment.status)).toEqual([
      'dispatched',
      'dispatched',
    ])
    pending[0].resolve({ secret: 'aa' })
    pending[1].resolve({ secret: 'bb' })
    await flush()
  })

  it('leaves a payment untouched when the settlement check times out', async () => {
    const { service, store, rollbacks } = setup({ hangSettlement: true })
    store.seed(makeRecord({ stage: 'sweeping', publishedAt: NOW }))
    await service.resumeAll()
    expect(store.records.get('payout-1')?.payments.map((payment) => payment.status)).toEqual([
      'dispatched',
      'dispatched',
    ])
    expect(rollbacks).toEqual([])
  })

  it('leaves a payment untouched when its operation is still executing elsewhere', async () => {
    const { service, store, settlements } = setup({ settlementStates: ['executing', 'executing'] })
    store.seed(makeRecord({ stage: 'paying' }))
    await service.resumeAll()
    expect(settlements).toHaveLength(2)
    expect(store.records.get('payout-1')?.payments.map((payment) => payment.status)).toEqual([
      'dispatched',
      'dispatched',
    ])
  })

  it('leaves a payment untouched when the settlement check fails', async () => {
    const { service, store, rollbacks } = setup({ settlementError: true })
    store.seed(makeRecord({ stage: 'paying' }))
    await service.resumeAll()
    expect(store.records.get('payout-1')?.payments.map((payment) => payment.status)).toEqual([
      'dispatched',
      'dispatched',
    ])
    expect(rollbacks).toEqual([])
    expect(await service.inFlightAmount()).toBe(100084)
  })

  it('marks a payment rolled back when the library already rolled it back', async () => {
    const { service, store, rollbacks } = setup({ settlementStates: ['rolled_back', 'rolled_back'] })
    store.seed(makeRecord({ stage: 'sweeping', publishedAt: NOW }))
    await service.resumeAll()
    expect(store.records.get('payout-1')?.payments.map((payment) => payment.status)).toEqual([
      'rolled_back',
      'rolled_back',
    ])
    expect(rollbacks).toEqual([])
    expect(await service.inFlightAmount()).toBe(0)
  })

  it('settles only after every record got its provider step', async () => {
    const { service, store, control, paymentControl } = setup({
      settlementStates: ['pending', 'pending', 'pending', 'pending'],
    })
    let resumes = 0
    control.onResume = () => {
      resumes += 1
    }
    let resumesSeenBySettlement = -1
    paymentControl.onSettlementCheck = () => {
      if (resumesSeenBySettlement === -1) resumesSeenBySettlement = resumes
    }
    store.seed(makeRecord({ id: 'a', stage: 'paying' }))
    store.seed(makeRecord({ id: 'b', stage: 'paying' }))
    await service.resumeAll()
    expect(resumes).toBe(2)
    expect(resumesSeenBySettlement).toBe(2)
  })

  it('does not let a hanging settlement check block another record', async () => {
    const { service, store, control, paymentControl } = setup({ hangSettlement: true })
    let resumes = 0
    control.onResume = () => {
      resumes += 1
    }
    let resumesSeenBySettlement = -1
    paymentControl.onSettlementCheck = () => {
      if (resumesSeenBySettlement === -1) resumesSeenBySettlement = resumes
    }
    store.seed(makeRecord({ id: 'a', stage: 'paying' }))
    store.seed(makeRecord({ id: 'b', stage: 'sweeping', publishedAt: NOW }))
    await service.resumeAll()
    expect(resumes).toBe(2)
    expect(resumesSeenBySettlement).toBe(2)
  })

  it('settles payments even when the provider step threw', async () => {
    const { service, store, control } = setup({ settlementStates: ['finalized', 'finalized'] })
    store.seed(makeRecord({ stage: 'paying' }))
    control.resumeError = new Error('provider down')
    await service.resumeAll()
    expect(store.records.get('payout-1')?.payments.map((payment) => payment.status)).toEqual([
      'paid',
      'paid',
    ])
  })

  it('keeps a completed payout completed', async () => {
    const { service, store, control, calls } = setup()
    store.seed(
      makeRecord({
        stage: 'completed',
        phase: 'settled',
        payments: makeRecord().payments.map((payment) => ({
          ...payment,
          status: 'paid' as const,
        })),
      }),
    )
    control.resume = { progress: { stage: 'refunded' } }
    await service.resumeAll()
    expect(calls).not.toContain('resume')
    expect(store.records.get('payout-1')?.stage).toBe('completed')
  })

  it('resumes once for concurrent calls', async () => {
    const { service, store, calls } = setup()
    store.seed(makeRecord({ stage: 'funded' }))
    await Promise.all([service.resumeAll(), service.resumeAll()])
    expect(calls.filter((call) => call === 'resume')).toHaveLength(1)
  })
})

describe('onchain payout service views', () => {
  it('sums the uncovered in-flight amount per mint', async () => {
    const { service, store, heldCalls } = setup()
    store.seed(
      makeRecord({
        id: 'a',
        mintUrl: MINT,
        payments: [
          { request: 'a', amount: 1000, operationId: 'op-a', feeReserve: 10, status: 'prepared', feePaid: null, settledAt: null },
          { request: 'b', amount: 2000, operationId: 'op-b', feeReserve: 20, status: 'dispatched', feePaid: null, settledAt: null },
          { request: 'c', amount: 4000, operationId: 'op-c', feeReserve: 40, status: 'paid', feePaid: 5, settledAt: 1 },
        ],
      }),
    )
    store.seed(
      makeRecord({
        id: 'b',
        mintUrl: 'https://other.example.com',
        payments: [
          { request: 'd', amount: 500, operationId: 'op-d', feeReserve: 5, status: 'dispatched', feePaid: null, settledAt: null },
        ],
      }),
    )
    expect(await service.inFlightAmount()).toBe(3030 + 505)
    const beforeSingleMint = heldCalls.length
    expect(await service.inFlightAmount(MINT)).toBe(3030)
    expect(heldCalls.slice(beforeSingleMint)).toEqual([
      { mintUrl: MINT, operationIds: ['op-a', 'op-b'] },
    ])
    expect(await service.inFlightAmount('https://other.example.com')).toBe(505)
  })

  it('deducts nothing while the payout operations still hold every proof', async () => {
    const { service, store, paymentControl } = setup()
    store.seed(openRecord())
    paymentControl.held = { 'op-fee': 45500, 'op-main': 55500 }
    expect(await service.inFlightAmount(MINT)).toBe(0)
  })

  it('deducts the full amount once the payout operations hold nothing', async () => {
    const { service, store, paymentControl } = setup()
    store.seed(openRecord())
    paymentControl.held = {}
    expect(await service.inFlightAmount(MINT)).toBe(101000)
  })

  it('deducts only the part the payout operations no longer hold', async () => {
    const { service, store, paymentControl } = setup()
    store.seed(openRecord())
    paymentControl.held = { 'op-fee': 45500 }
    expect(await service.inFlightAmount(MINT)).toBe(55500)
  })

  it('deducts nothing while a swapped payment still holds its send proofs', async () => {
    const { service, store, paymentControl } = setup()
    store.seed(
      openRecord({
        payments: [
          { request: 'main', amount: 55000, operationId: 'op-main', feeReserve: 500, status: 'dispatched', feePaid: null, settledAt: null },
        ],
      }),
    )
    paymentControl.held = { 'op-main': 55500 }
    expect(await service.inFlightAmount(MINT)).toBe(0)

    paymentControl.held = { 'op-main': 0 }
    expect(await service.inFlightAmount(MINT)).toBe(55500)
  })

  it('does not let one payment surplus hide another payment shortfall', async () => {
    const { service, store, paymentControl } = setup()
    store.seed(
      openRecord({
        payments: [
          { request: 'a', amount: 9991, operationId: 'op-a', feeReserve: 9, status: 'dispatched', feePaid: null, settledAt: null },
          { request: 'b', amount: 795, operationId: 'op-b', feeReserve: 5, status: 'dispatched', feePaid: null, settledAt: null },
        ],
      }),
    )
    paymentControl.held = { 'op-a': 10900, 'op-b': 0 }
    expect(await service.inFlightAmount(MINT)).toBe(800)
  })

  it('counts a payment without an operation id fully', async () => {
    const { service, store, paymentControl, heldCalls } = setup()
    store.seed(
      openRecord({
        payments: [
          { request: 'fee', amount: 45000, operationId: 'op-fee', feeReserve: 500, status: 'dispatched', feePaid: null, settledAt: null },
          { request: 'main', amount: 55000, operationId: null, feeReserve: 500, status: 'prepared', feePaid: null, settledAt: null },
        ],
      }),
    )
    paymentControl.held = { 'op-fee': 45500 }
    expect(await service.inFlightAmount(MINT)).toBe(55500)
    expect(heldCalls[0].operationIds).toEqual(['op-fee'])
  })

  it('counts the full amount when the held look-up fails', async () => {
    const { service, store, paymentControl } = setup()
    store.seed(openRecord())
    paymentControl.heldError = true
    expect(await service.inFlightAmount(MINT)).toBe(101000)
  })

  it('returns views and lists active records', async () => {
    const { service, store } = setup()
    store.seed(makeRecord({ id: 'one' }))
    expect((await service.get('one'))?.id).toBe('one')
    expect(await service.get('missing')).toBeNull()
    expect((await service.listActive()).map((view) => view.id)).toEqual(['one'])
    expect(service.isEnabled()).toBe(true)
  })

  it('reports whether a payout still has open payments', async () => {
    const { service, store } = setup()
    store.seed(
      makeRecord({
        id: 'open',
        stage: 'completed',
        payments: [
          { request: 'a', amount: 1000, operationId: 'op-a', feeReserve: 10, status: 'dispatched', feePaid: null, settledAt: null },
        ],
      }),
    )
    store.seed(
      makeRecord({
        id: 'settled',
        stage: 'completed',
        payments: [
          { request: 'b', amount: 1000, operationId: 'op-b', feeReserve: 10, status: 'paid', feePaid: 1, settledAt: 1 },
        ],
      }),
    )
    expect((await service.get('open'))?.hasOpenPayments).toBe(true)
    expect((await service.get('settled'))?.hasOpenPayments).toBe(false)
  })
})
