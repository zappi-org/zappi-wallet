import {
  advancePayoutStage,
  type OnchainPayoutStage,
} from '@/core/domain/onchain-payout'
import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'
import { Err, Ok, type Result } from '@/core/domain/result'
import { BaseError, UnknownError } from '@/core/errors/base'
import {
  OnchainPayoutAmountOutOfRangeError,
  OnchainPayoutProviderRejectedError,
  OnchainPayoutQuoteExpiredError,
  OnchainPayoutUnavailableError,
} from '@/core/errors/onchain-payout'
import type { EventBus } from '@/core/events/event-bus'
import type {
  OnchainPayoutProgress,
  OnchainPayoutProvider,
  OnchainPayoutQuote,
} from '@/core/ports/driven/onchain-payout-provider.port'
import type {
  OnchainPayoutPayment,
  OnchainPayoutRecord,
  OnchainPayoutStore,
  OnchainPayoutUpdate,
} from '@/core/ports/driven/onchain-payout-store.port'
import type {
  ExecutedRouteMelt,
  RoutePaymentOperator,
} from '@/core/ports/driven/route-payment-operator.port'
import type {
  OnchainPayoutQuoteView,
  OnchainPayoutUseCase,
  OnchainPayoutView,
} from '@/core/ports/driving/onchain-payout.usecase'

const MAX_UPDATE_TRIES = 5
const DEFAULT_STATUS_TIMEOUT_MS = 15_000
const RESUMABLE_STAGES: OnchainPayoutStage[] = ['paying', 'funded', 'sweeping']

export interface OnchainPayoutServiceLogger {
  warn(message: string): void
}

export interface OnchainPayoutServiceDeps {
  provider: OnchainPayoutProvider
  store: OnchainPayoutStore
  payments: Pick<
    RoutePaymentOperator,
    'prepareMelt' | 'executeMelt' | 'rollbackMelt' | 'refreshMelt'
  >
  eventBus: EventBus
  enabled: () => boolean
  now: () => number
  newId: () => string
  statusTimeoutMs?: number
  logger?: OnchainPayoutServiceLogger
}

interface PendingQuote {
  quote: OnchainPayoutQuote
  mintUrl: string
  expiresAt: number
}

export class OnchainPayoutService implements OnchainPayoutUseCase {
  private readonly provider: OnchainPayoutProvider
  private readonly store: OnchainPayoutStore
  private readonly payments: OnchainPayoutServiceDeps['payments']
  private readonly eventBus: EventBus
  private readonly enabled: () => boolean
  private readonly now: () => number
  private readonly newId: () => string
  private readonly statusTimeoutMs: number
  private readonly logger?: OnchainPayoutServiceLogger

  private readonly quotes = new Map<string, PendingQuote>()
  private readonly pendingExecutions = new Set<string>()
  private resumePromise: Promise<void> | null = null

  constructor(deps: OnchainPayoutServiceDeps) {
    this.provider = deps.provider
    this.store = deps.store
    this.payments = deps.payments
    this.eventBus = deps.eventBus
    this.enabled = deps.enabled
    this.now = deps.now
    this.newId = deps.newId
    this.statusTimeoutMs = deps.statusTimeoutMs ?? DEFAULT_STATUS_TIMEOUT_MS
    this.logger = deps.logger
  }

  isEnabled(): boolean {
    return this.enabled()
  }

  async quote(params: {
    sendAmount: number
    destination: string
    mintUrl: string
  }): Promise<Result<OnchainPayoutQuoteView, BaseError>> {
    if (!this.enabled()) {
      return Err(new OnchainPayoutUnavailableError('onchain payout is disabled'))
    }
    if (!Number.isSafeInteger(params.sendAmount) || params.sendAmount <= 0) {
      return Err(
        new OnchainPayoutAmountOutOfRangeError(
          'payout amount must be a positive integer',
          1,
          Number.MAX_SAFE_INTEGER,
        ),
      )
    }
    this.pruneQuotes()
    let quote: OnchainPayoutQuote
    try {
      quote = await this.provider.quote({
        sendAmount: params.sendAmount,
        destination: params.destination,
      })
    } catch (error) {
      return Err(
        error instanceof BaseError
          ? error
          : new OnchainPayoutUnavailableError('payout quote failed', error),
      )
    }
    const quoteId = this.newId()
    this.quotes.set(quoteId, {
      quote,
      mintUrl: params.mintUrl,
      expiresAt: quote.expiresAt,
    })
    return Ok({
      quoteId,
      providerId: quote.providerId,
      destination: quote.destination,
      sendAmount: quote.sendAmount,
      receiveAmount: quote.receiveAmount,
      serviceFee: quote.serviceFee,
      networkFee: quote.networkFee,
      sweepFee: quote.sweepFee,
      limits: quote.limits,
      estimatedMinutes: quote.estimatedMinutes,
      expiresAt: quote.expiresAt,
    })
  }

  async start(params: {
    quoteId: string
    mintUrl: string
  }): Promise<Result<OnchainPayoutView, BaseError>> {
    const pending = this.quotes.get(params.quoteId)
    if (!pending || pending.expiresAt < this.now() || pending.mintUrl !== params.mintUrl) {
      this.quotes.delete(params.quoteId)
      return Err(new OnchainPayoutQuoteExpiredError('payout quote has expired'))
    }
    this.quotes.delete(params.quoteId)
    const { quote, mintUrl } = pending

    let started
    try {
      started = await this.provider.start({ quote })
    } catch (error) {
      return Err(
        error instanceof BaseError
          ? error
          : new OnchainPayoutProviderRejectedError('payout start failed', error),
      )
    }

    const requestsTotal = started.paymentRequests.reduce(
      (sum, request) => sum + request.amount,
      0,
    )
    if (
      started.sendAmount !== quote.sendAmount ||
      requestsTotal !== started.sendAmount ||
      started.receiveAmount < quote.receiveAmount
    ) {
      return Err(
        new OnchainPayoutProviderRejectedError('provider returned inconsistent amounts'),
      )
    }

    const id = this.newId()
    const at = this.now()
    const record: OnchainPayoutRecord = {
      id,
      version: 1,
      providerId: this.provider.id,
      mintUrl,
      destination: quote.destination,
      sendAmount: started.sendAmount,
      receiveAmount: started.receiveAmount,
      stage: 'quoted',
      phase: 'preparing',
      providerRef: started.providerRef,
      payments: started.paymentRequests.map((request) => ({
        request: request.request,
        amount: request.amount,
        operationId: null,
        feeReserve: 0,
        status: 'prepared',
        feePaid: null,
        settledAt: null,
      })),
      payoutTxId: null,
      failureReason: null,
      publishedAt: null,
      deadline: started.deadline,
      createdAt: at,
      updatedAt: at,
    }

    try {
      await this.store.create(record, started.secrets)
    } catch (error) {
      return Err(new UnknownError('could not persist the payout', error))
    }
    this.emit(record)

    const preparedOperations: string[] = []
    for (let index = 0; index < record.payments.length; index++) {
      try {
        const result = await this.payments.prepareMelt(
          mintUrl,
          record.payments[index].request,
        )
        const stored = await this.persist(id, (current) => ({
          payments: current.payments.map((payment, paymentIndex) =>
            paymentIndex === index
              ? {
                  ...payment,
                  operationId: result.operationId,
                  feeReserve: result.feeReserve,
                }
              : payment,
          ),
        }))
        if (!stored) {
          return this.failPrepare(
            id,
            [...preparedOperations, result.operationId],
            new UnknownError('payout record update failed'),
          )
        }
        preparedOperations.push(result.operationId)
      } catch (error) {
        return this.failPrepare(
          id,
          preparedOperations,
          error instanceof BaseError ? error : new UnknownError('payout prepare failed', error),
        )
      }
    }

    const dispatched = await this.persist(id, (current) => ({
      payments: current.payments.map((payment) => ({
        ...payment,
        status: 'dispatched' as const,
      })),
      stage: 'paying',
      phase: this.phaseFor(current, 'paying'),
    }))
    if (!dispatched) {
      return Err(new UnknownError('payout record update failed'))
    }

    const operationIds = dispatched.payments
      .map((payment) => payment.operationId)
      .filter((operationId): operationId is string => operationId !== null)

    void Promise.all(
      operationIds.map((operationId) => {
        this.pendingExecutions.add(operationId)
        return this.payments.executeMelt(operationId).then(
          (result) => {
            this.pendingExecutions.delete(operationId)
            return this.onPaymentResult(id, operationId, result)
          },
          (error: unknown) => {
            this.pendingExecutions.delete(operationId)
            return this.onPaymentError(id, operationId, error)
          },
        )
      }),
    )

    return Ok(this.viewOf(dispatched))
  }

  async resumeAll(): Promise<void> {
    if (this.resumePromise) return this.resumePromise
    this.resumePromise = this.runResumeAll().finally(() => {
      this.resumePromise = null
    })
    return this.resumePromise
  }

  async get(id: string): Promise<OnchainPayoutView | null> {
    const record = await this.store.get(id)
    return record ? this.viewOf(record) : null
  }

  async listActive(): Promise<OnchainPayoutView[]> {
    const records = await this.store.listActive()
    return records.map((record) => this.viewOf(record))
  }

  async inFlightAmount(mintUrl?: string): Promise<number> {
    const records = await this.store.listActive()
    let total = 0
    for (const record of records) {
      if (mintUrl !== undefined && record.mintUrl !== mintUrl) continue
      for (const payment of record.payments) {
        if (payment.status !== 'prepared' && payment.status !== 'dispatched') continue
        total += payment.amount + payment.feeReserve
      }
    }
    return total
  }

  private async runResumeAll(): Promise<void> {
    const records = await this.store.listActive()
    for (const record of records) {
      try {
        await this.resumeRecord(record)
      } catch (error) {
        this.logger?.warn(
          `payout resume failed: ${record.id} ${error instanceof Error ? error.message : ''}`,
        )
      }
    }
  }

  private async resumeRecord(record: OnchainPayoutRecord): Promise<void> {
    if (record.stage === 'quoted') {
      await this.rollbackPrepared(record)
      return
    }
    if (RESUMABLE_STAGES.includes(record.stage)) {
      await this.resumeProvider(record)
      return
    }
    await this.reconcile(record.id)
  }

  private async resumeProvider(record: OnchainPayoutRecord): Promise<void> {
    const secrets = await this.store.readSecrets(record.id)
    if (secrets === null) {
      this.logger?.warn(`payout secrets are missing: ${record.id}`)
      return
    }
    const advance = await this.provider.resume({
      providerRef: record.providerRef,
      secrets,
      stage: record.stage,
      published: record.publishedAt !== null,
    })
    if (advance.prepared) {
      await this.publishPrepared(record, advance.prepared)
      return
    }
    if (advance.progress.stage === 'sweeping' && record.publishedAt !== null) {
      const progress = await this.provider.publish({
        providerRef: record.providerRef,
        secrets,
      })
      await this.applyProgress(record.id, progress)
      await this.reconcile(record.id)
      return
    }
    await this.applyProgress(record.id, advance.progress)
    await this.reconcile(record.id)
  }

  private async publishPrepared(
    record: OnchainPayoutRecord,
    prepared: { secrets: string; payoutTxId: string },
  ): Promise<void> {
    const swept = await this.writeOnce(record, record.version, {
      secrets: prepared.secrets,
      stage: 'sweeping',
      phase: this.phaseFor(record, 'sweeping'),
      payoutTxId: prepared.payoutTxId,
    })
    if (!swept) return
    const published = await this.writeOnce(swept, swept.version, {
      publishedAt: this.now(),
    })
    if (!published) return
    const progress = await this.provider.publish({
      providerRef: record.providerRef,
      secrets: prepared.secrets,
    })
    await this.applyProgress(record.id, progress)
    await this.reconcile(record.id)
  }

  private async failPrepare(
    id: string,
    operations: string[],
    error: BaseError,
  ): Promise<Result<OnchainPayoutView, BaseError>> {
    for (const operationId of operations) {
      if (this.pendingExecutions.has(operationId)) continue
      try {
        await this.payments.rollbackMelt(operationId, 'prepare_failed')
      } catch (rollbackError) {
        this.logger?.warn(
          `payout rollback failed: ${operationId} ${rollbackError instanceof Error ? rollbackError.message : ''}`,
        )
      }
    }
    await this.persist(id, (current) => ({
      stage: 'aborted',
      phase: this.phaseFor(current, 'aborted'),
      failureReason: 'prepare_failed',
    }))
    return Err(error)
  }

  private async rollbackPrepared(record: OnchainPayoutRecord): Promise<void> {
    for (const payment of record.payments) {
      if (payment.operationId === null) continue
      try {
        await this.payments.rollbackMelt(payment.operationId, 'interrupted_before_payment')
      } catch (error) {
        this.logger?.warn(
          `payout rollback failed: ${payment.operationId} ${error instanceof Error ? error.message : ''}`,
        )
      }
    }
    await this.persist(record.id, (current) => ({
      stage: 'aborted',
      phase: this.phaseFor(current, 'aborted'),
      failureReason: 'interrupted_before_payment',
      payments: current.payments.map((payment) =>
        payment.status === 'prepared'
          ? { ...payment, status: 'rolled_back' as const }
          : payment,
      ),
    }))
  }

  private async applyProgress(id: string, progress: OnchainPayoutProgress): Promise<void> {
    await this.persist(id, (current) => {
      if (current.phase === 'settled' && progress.stage !== 'completed') {
        this.logger?.warn(`payout stage regression ignored: ${id}`)
        return null
      }
      const changes: OnchainPayoutUpdate = {
        stage: progress.stage,
        phase: this.phaseFor(current, progress.stage),
      }
      if (progress.payoutTxId !== undefined) changes.payoutTxId = progress.payoutTxId
      if (progress.failureReason !== undefined) changes.failureReason = progress.failureReason
      return changes
    })
  }

  private async reconcile(id: string): Promise<void> {
    const record = await this.store.get(id)
    if (!record) return
    if (record.stage === 'completed') {
      await this.reconcileCompleted(record)
      return
    }
    if (record.stage === 'refunded' || record.stage === 'aborted') {
      await this.reconcileTerminal(record)
    }
  }

  private async reconcileCompleted(record: OnchainPayoutRecord): Promise<void> {
    for (const payment of record.payments) {
      if (payment.operationId === null) continue
      if (this.pendingExecutions.has(payment.operationId)) continue
      if (payment.status === 'paid' || payment.status === 'rolled_back') continue
      const state = await this.refreshWithTimeout(payment.operationId)
      if (state === 'finalized') {
        await this.markPayment(record.id, payment.operationId, () => ({ status: 'paid' }))
        continue
      }
      if (state === 'rolled_back') {
        await this.markPayment(record.id, payment.operationId, () => ({ status: 'rolled_back' }))
      }
    }
  }

  private async reconcileTerminal(record: OnchainPayoutRecord): Promise<void> {
    for (const payment of record.payments) {
      if (payment.status !== 'dispatched') continue
      if (payment.operationId === null) continue
      if (this.pendingExecutions.has(payment.operationId)) continue
      const state = await this.refreshWithTimeout(payment.operationId)
      if (state === 'prepared') {
        try {
          await this.payments.rollbackMelt(payment.operationId, 'payout_refunded')
        } catch (error) {
          this.logger?.warn(
            `payout rollback failed: ${payment.operationId} ${error instanceof Error ? error.message : ''}`,
          )
          continue
        }
        await this.markPayment(record.id, payment.operationId, () => ({ status: 'rolled_back' }))
        continue
      }
      if (state === 'finalized') {
        await this.markPayment(record.id, payment.operationId, () => ({ status: 'paid' }))
        continue
      }
      if (state === 'rolled_back') {
        await this.markPayment(record.id, payment.operationId, () => ({ status: 'rolled_back' }))
      }
    }
  }

  private async refreshWithTimeout(operationId: string): Promise<string | null> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), this.statusTimeoutMs)
      })
      const result = await Promise.race([
        this.payments.refreshMelt(operationId),
        timeout,
      ])
      return result ? result.state : null
    } catch {
      return null
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private async onPaymentResult(
    id: string,
    operationId: string,
    result: ExecutedRouteMelt,
  ): Promise<void> {
    if (!result.secret) return
    await this.markPayment(id, operationId, (payment) => ({
      status: 'paid',
      feePaid: result.effectiveFee ?? payment.feePaid,
      settledAt: this.now(),
    }))
  }

  private async onPaymentError(
    id: string,
    operationId: string,
    error: unknown,
  ): Promise<void> {
    this.logger?.warn(
      `payout payment failed: ${id} ${operationId} ${error instanceof Error ? error.message : ''}`,
    )
  }

  private async markPayment(
    id: string,
    operationId: string,
    patch: (payment: OnchainPayoutPayment) => Partial<OnchainPayoutPayment>,
  ): Promise<void> {
    await this.persist(id, (current) => {
      const index = current.payments.findIndex(
        (payment) => payment.operationId === operationId,
      )
      if (index === -1) return null
      const payment = current.payments[index]
      if (payment.status === 'paid' || payment.status === 'rolled_back') return null
      const change = patch(payment)
      return {
        payments: current.payments.map((candidate, candidateIndex) =>
          candidateIndex === index ? { ...candidate, ...change } : candidate,
        ),
      }
    })
  }

  private async writeOnce(
    record: OnchainPayoutRecord,
    expectedVersion: number,
    changes: OnchainPayoutUpdate,
  ): Promise<OnchainPayoutRecord | null> {
    const updatedAt = this.now()
    const applied = await this.store.update(record.id, expectedVersion, {
      ...changes,
      updatedAt,
    })
    if (!applied) return null
    const { secrets: _secrets, ...persisted } = changes
    const next: OnchainPayoutRecord = {
      ...record,
      ...persisted,
      updatedAt,
      version: expectedVersion + 1,
    }
    this.emit(next)
    return next
  }

  private async persist(
    id: string,
    mutate: (record: OnchainPayoutRecord) => OnchainPayoutUpdate | null,
  ): Promise<OnchainPayoutRecord | null> {
    for (let attempt = 0; attempt < MAX_UPDATE_TRIES; attempt++) {
      const record = await this.store.get(id)
      if (!record) return null
      const changes = mutate(record)
      if (!changes) return record
      const updatedAt = this.now()
      const applied = await this.store.update(id, record.version, {
        ...changes,
        updatedAt,
      })
      if (!applied) continue
      const { secrets: _secrets, ...persisted } = changes
      const next: OnchainPayoutRecord = {
        ...record,
        ...persisted,
        updatedAt,
        version: record.version + 1,
      }
      this.emit(next)
      return next
    }
    this.logger?.warn(`payout update gave up: ${id}`)
    return null
  }

  private pruneQuotes(): void {
    const now = this.now()
    for (const [quoteId, entry] of this.quotes) {
      if (entry.expiresAt < now) this.quotes.delete(quoteId)
    }
  }

  private phaseFor(record: OnchainPayoutRecord, stage: OnchainPayoutStage): TransferPhase {
    try {
      return advancePayoutStage(this.asTransfer(record), stage, this.now()).phase
    } catch (error) {
      this.logger?.warn(
        `payout phase guard: ${record.id} ${error instanceof Error ? error.message : ''}`,
      )
      return record.phase
    }
  }

  private asTransfer(record: OnchainPayoutRecord): PendingTransfer {
    return {
      id: record.id,
      txId: record.payoutTxId ?? record.id,
      direction: 'outgoing',
      phase: record.phase,
      finality: 'revocable',
      onExpiry: 'reclaim',
      transportRef: null,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      amount: record.receiveAmount,
    }
  }

  private viewOf(record: OnchainPayoutRecord): OnchainPayoutView {
    return {
      id: record.id,
      mintUrl: record.mintUrl,
      destination: record.destination,
      sendAmount: record.sendAmount,
      receiveAmount: record.receiveAmount,
      stage: record.stage,
      phase: record.phase,
      payoutTxId: record.payoutTxId,
      failureReason: record.failureReason,
      hasOpenPayments: record.payments.some(
        (payment) => payment.status === 'prepared' || payment.status === 'dispatched',
      ),
      deadline: record.deadline,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }
  }

  private emit(record: OnchainPayoutRecord): void {
    this.eventBus.emit({
      type: 'onchain-payout:updated',
      payload: this.viewOf(record),
    })
  }
}
