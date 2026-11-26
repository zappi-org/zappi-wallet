import { describe, expect, it } from 'vitest'
import type { DomainEvent } from '@/core/events/domain-events'
import type { EventBus } from '@/core/events/event-bus'
import {
  OnchainPayoutAmountOutOfRangeError,
  OnchainPayoutProviderRejectedError,
  OnchainPayoutQuoteExpiredError,
  OnchainPayoutUnavailableError,
} from '@/core/errors/onchain-payout'
import type {
  OnchainPayoutAdvance,
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
import { InsufficientBalanceError } from '@/core/errors/payment.errors'

const NOW = 1_700_000_000_000
const MINT = 'https://mint.example.com'

type Payments = Pick<
  RoutePaymentOperator,
  'prepareMelt' | 'executeMelt' | 'rollbackMelt' | 'refreshMelt'
>

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function makeQuote(patch: Partial<OnchainPayoutQuote> = {}): OnchainPayoutQuote {
  return {
    providerId: 'fake',
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

  constructor(private readonly timeline: string[]) {}

  seed(record: OnchainPayoutRecord, secrets = 'secrets-1'): void {
    this.records.set(record.id, clone(record))
    this.secrets.set(record.id, secrets)
  }

  async create(record: OnchainPayoutRecord, secrets: string): Promise<void> {
    this.timeline.push(`store:create:${record.id}`)
    this.records.set(record.id, clone(record))
    this.secrets.set(record.id, secrets)
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
    return true
  }

  async readSecrets(id: string): Promise<string | null> {
    return this.secrets.get(id) ?? null
  }

  async listActive(): Promise<OnchainPayoutRecord[]> {
    return [...this.records.values()].map(clone)
  }

  async list(): Promise<OnchainPayoutRecord[]> {
    return [...this.records.values()].map(clone)
  }
}

interface ProviderControl {
  quote?: OnchainPayoutQuote
  start?: OnchainPayoutStartResult
  resume?: OnchainPayoutAdvance
  startError?: unknown
  quoteError?: unknown
  onResume?: () => void
}

function createProvider(control: ProviderControl, timeline: string[]) {
  const calls: string[] = []
  const provider: OnchainPayoutProvider = {
    id: 'fake',
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
}

function createPayments(control: PaymentControl, timeline: string[]) {
  const order: string[] = []
  const rollbacks: string[] = []
  const refreshes: string[] = []
  const pending: {
    operationId: string
    resolve: (result: ExecutedRouteMelt) => void
    reject: (error: unknown) => void
  }[] = []
  let refreshIndex = 0

  const payments: Payments = {
    async prepareMelt(_mintUrl, request) {
      order.push(`prepare:${request}`)
      timeline.push(`prepare:${request}`)
      const prepareCount = order.filter((entry) => entry.startsWith('prepare:')).length - 1
      if (control.prepareFailIndex === prepareCount) {
        throw new InsufficientBalanceError(100000, 10)
      }
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
      rollbacks.push(operationId)
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
  return { payments, order, rollbacks, refreshes, pending }
}

function setup(
  options: {
    enabled?: boolean
    statusTimeoutMs?: number
    prepareFailIndex?: number
    refreshStates?: string[]
    hangFirstRefresh?: boolean
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
    ...providerKit,
    ...paymentKit,
    timeline,
    events,
    clock,
  }
}

async function quoteAndStart(service: OnchainPayoutService) {
  const quoted = await service.quote({
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

describe('onchain payout service start', () => {
  it('persists secrets before the first payment is prepared', async () => {
    const { service, timeline, events } = setup()
    const started = await quoteAndStart(service)
    expect(started.ok).toBe(true)
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
      'prepared',
      'prepared',
    ])
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

describe('onchain payout service quote', () => {
  it('reports unavailability when disabled', async () => {
    const { service } = setup({ enabled: false })
    const result = await service.quote({
      sendAmount: 100000,
      destination: 'bcrt1qdestination',
      mintUrl: MINT,
    })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toBeInstanceOf(OnchainPayoutUnavailableError)
  })

  it('rejects a non-positive amount', async () => {
    const { service } = setup()
    const result = await service.quote({
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
      sendAmount: 100000,
      destination: 'bcrt1qdestination',
      mintUrl: MINT,
    })
    expect(!result.ok && result.error).toBeInstanceOf(OnchainPayoutUnavailableError)
  })

  it('expires quotes, rejects a mint mismatch and allows a single start', async () => {
    const { service, clock } = setup()
    const quoted = await service.quote({
      sendAmount: 100000,
      destination: 'bcrt1qdestination',
      mintUrl: MINT,
    })
    if (!quoted.ok) throw new Error('quote failed')
    const mismatch = await service.start({
      quoteId: quoted.value.quoteId,
      mintUrl: 'https://other.example.com',
    })
    expect(!mismatch.ok && mismatch.error).toBeInstanceOf(OnchainPayoutQuoteExpiredError)

    const second = await service.quote({
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
  it('sums in-flight amounts per mint', async () => {
    const { service, store } = setup()
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
    expect(await service.inFlightAmount(MINT)).toBe(3030)
    expect(await service.inFlightAmount('https://other.example.com')).toBe(505)
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
