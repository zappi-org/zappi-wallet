import {
  advancePayoutStage,
  type SwapOutStage,
} from '@/core/domain/swap-out'
import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'
import { Err, Ok, type Result } from '@/core/domain/result'
import { BaseError, UnknownError } from '@/core/errors/base'
import {
  SwapOutAmountOutOfRangeError,
  SwapOutProviderRejectedError,
  SwapOutQuoteExpiredError,
  SwapOutUnavailableError,
} from '@/core/errors/swap-out'
import type { EventBus } from '@/core/events/event-bus'
import type {
  SwapOutOffer,
  SwapOutProgress,
  SwapOutProvider,
  SwapOutQuote,
} from '@/core/ports/driven/swap-out-provider.port'
import type {
  SwapOutPayment,
  SwapOutRecord,
  SwapOutStore,
  SwapOutUpdate,
} from '@/core/ports/driven/swap-out-store.port'
import type {
  ExecutedRouteMelt,
  RoutePaymentOperator,
} from '@/core/ports/driven/route-payment-operator.port'
import type {
  SwapOutQuoteView,
  SwapOutUseCase,
  SwapOutView,
} from '@/core/ports/driving/swap-out.usecase'

const MAX_UPDATE_TRIES = 5
const DEFAULT_STATUS_TIMEOUT_MS = 15_000
const RESUMABLE_STAGES: SwapOutStage[] = ['paying', 'funded', 'sweeping']

export interface SwapOutServiceLogger {
  warn(message: string): void
}

export interface SwapOutServiceDeps {
  provider: SwapOutProvider
  store: SwapOutStore
  payments: Pick<
    RoutePaymentOperator,
    | 'prepareMelt'
    | 'executeMelt'
    | 'rollbackMelt'
    | 'refreshMelt'
    | 'checkMeltSettlement'
    | 'heldAmounts'
  >
  eventBus: EventBus
  enabled: () => boolean
  now: () => number
  newId: () => string
  statusTimeoutMs?: number
  logger?: SwapOutServiceLogger
}

interface PendingQuote {
  quote: SwapOutQuote
  mintUrl: string
  expiresAt: number
}

export class SwapOutService implements SwapOutUseCase {
  private readonly provider: SwapOutProvider
  private readonly store: SwapOutStore
  private readonly payments: SwapOutServiceDeps['payments']
  private readonly eventBus: EventBus
  private readonly enabled: () => boolean
  private readonly now: () => number
  private readonly newId: () => string
  private readonly statusTimeoutMs: number
  private readonly logger?: SwapOutServiceLogger

  private readonly quotes = new Map<string, PendingQuote>()
  private readonly starting = new Set<string>()
  private readonly pendingExecutions = new Set<string>()
  private resumePromise: Promise<void> | null = null

  constructor(deps: SwapOutServiceDeps) {
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

  async listOffers(): Promise<Result<SwapOutOffer[], BaseError>> {
    if (!this.enabled()) {
      return Err(new SwapOutUnavailableError('swap-out is disabled'))
    }
    try {
      return Ok(await this.provider.listOffers())
    } catch (error) {
      return Err(
        error instanceof BaseError
          ? error
          : new SwapOutUnavailableError('payout offers failed', error),
      )
    }
  }

  async quote(params: {
    offerId: string
    sendAmount: number
    destination: string
    mintUrl: string
  }): Promise<Result<SwapOutQuoteView, BaseError>> {
    if (!this.enabled()) {
      return Err(new SwapOutUnavailableError('swap-out is disabled'))
    }
    if (!Number.isSafeInteger(params.sendAmount) || params.sendAmount <= 0) {
      return Err(
        new SwapOutAmountOutOfRangeError(
          'payout amount must be a positive integer',
          1,
          Number.MAX_SAFE_INTEGER,
        ),
      )
    }
    this.pruneQuotes()
    let quote: SwapOutQuote
    try {
      quote = await this.provider.quote({
        offerId: params.offerId,
        sendAmount: params.sendAmount,
        destination: params.destination,
      })
    } catch (error) {
      return Err(
        error instanceof BaseError
          ? error
          : new SwapOutUnavailableError('payout quote failed', error),
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
      offerId: quote.offerId,
      identifier: quote.identifier,
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
  }): Promise<Result<SwapOutView, BaseError>> {
    const pending = this.quotes.get(params.quoteId)
    if (!pending || pending.expiresAt < this.now() || pending.mintUrl !== params.mintUrl) {
      this.quotes.delete(params.quoteId)
      return Err(new SwapOutQuoteExpiredError('payout quote has expired'))
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
          : new SwapOutProviderRejectedError('payout start failed', error),
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
        new SwapOutProviderRejectedError('provider returned inconsistent amounts'),
      )
    }

    const id = this.newId()
    const at = this.now()
    this.starting.add(id)
    const record: SwapOutRecord = {
      id,
      version: 1,
      providerId: this.provider.id,
      offerId: quote.offerId,
      identifier: quote.identifier,
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
      try {
        await this.store.create(record, started.secrets)
      } catch (error) {
        return Err(new UnknownError('could not persist the payout', error))
      }
      this.emit(record)
      const prepared = await this.prepareAndDispatch(record)
      return prepared
    } finally {
      this.starting.delete(id)
    }
  }

  private async prepareAndDispatch(
    record: SwapOutRecord,
  ): Promise<Result<SwapOutView, BaseError>> {
    const id = record.id
    const preparedOperations: string[] = []
    for (let index = 0; index < record.payments.length; index++) {
      try {
        const result = await this.payments.prepareMelt(
          record.mintUrl,
          record.payments[index].request,
        )
        const stored = await this.persist(id, (current) =>
          current.stage === 'quoted'
            ? {
                payments: current.payments.map((payment, paymentIndex) =>
                  paymentIndex === index
                    ? {
                        ...payment,
                        operationId: result.operationId,
                        feeReserve: result.feeReserve,
                      }
                    : payment,
                ),
              }
            : null,
        )
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

    const dispatched = await this.persist(id, (current) =>
      current.stage === 'quoted'
        ? {
            payments: current.payments.map((payment) => ({
              ...payment,
              status: 'dispatched' as const,
            })),
            stage: 'paying',
            phase: this.phaseFor(current, 'paying'),
          }
        : null,
    )
    if (!dispatched) {
      await this.rollbackOperations(preparedOperations, 'payout_not_dispatched')
      return Err(
        new SwapOutProviderRejectedError('payout was interrupted before dispatch'),
      )
    }

    void Promise.all(
      dispatched.payments.map((payment, index) => {
        const operationId = payment.operationId
        if (operationId === null) return Promise.resolve()
        this.pendingExecutions.add(operationId)
        return this.payments.executeMelt(operationId).then(
          (result) => {
            this.pendingExecutions.delete(operationId)
            return this.onPaymentResult(id, index, result)
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

  async get(id: string): Promise<SwapOutView | null> {
    const record = await this.store.get(id)
    return record ? this.viewOf(record) : null
  }

  async listActive(): Promise<SwapOutView[]> {
    const records = await this.store.listActive()
    return records.map((record) => this.viewOf(record))
  }

  async inFlightAmount(mintUrl?: string): Promise<number> {
    const records = await this.store.listActive()
    const perMint = new Map<string, SwapOutPayment[]>()
    for (const record of records) {
      if (mintUrl !== undefined && record.mintUrl !== mintUrl) continue
      const open = perMint.get(record.mintUrl) ?? []
      for (const payment of record.payments) {
        if (payment.status !== 'prepared' && payment.status !== 'dispatched') continue
        open.push(payment)
      }
      perMint.set(record.mintUrl, open)
    }
    let uncovered = 0
    for (const [recordMintUrl, open] of perMint) {
      uncovered += await this.uncoveredAmount(recordMintUrl, open)
    }
    return uncovered
  }

  private async uncoveredAmount(
    mintUrl: string,
    open: SwapOutPayment[],
  ): Promise<number> {
    const totalOf = (payment: SwapOutPayment) => payment.amount + payment.feeReserve
    const operationIds = open
      .map((payment) => payment.operationId)
      .filter((operationId): operationId is string => operationId !== null)
    let held: Record<string, number> = {}
    if (operationIds.length > 0) {
      try {
        held = await this.payments.heldAmounts(mintUrl, operationIds)
      } catch (error) {
        this.logger?.warn(
          `payout held amount failed: ${mintUrl} ${error instanceof Error ? error.message : ''}`,
        )
        return open.reduce((sum, payment) => sum + totalOf(payment), 0)
      }
    }
    return open.reduce((sum, payment) => {
      const heldByPayment = payment.operationId === null ? 0 : (held[payment.operationId] ?? 0)
      return sum + Math.max(0, totalOf(payment) - heldByPayment)
    }, 0)
  }

  private async runResumeAll(): Promise<void> {
    const records = await this.store.listActive()
    const settle: string[] = []
    for (const record of records) {
      if (this.starting.has(record.id)) continue
      if (RESUMABLE_STAGES.includes(record.stage)) settle.push(record.id)
      try {
        await this.resumeRecord(record)
      } catch (error) {
        this.logger?.warn(
          `payout resume failed: ${record.id} ${error instanceof Error ? error.message : ''}`,
        )
      }
    }
    await this.settleOpenPayments(settle)
  }

  private async resumeRecord(record: SwapOutRecord): Promise<void> {
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

  private async settleOpenPayments(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.statusTimeoutMs)
      })
      await Promise.race([
        Promise.allSettled(ids.map((id) => this.settleRecordPayments(id))),
        timeout,
      ])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }

  private async settleRecordPayments(id: string): Promise<void> {
    const record = await this.store.get(id)
    if (!record || !RESUMABLE_STAGES.includes(record.stage)) return
    await Promise.allSettled(
      record.payments.map(async (payment, index) => {
        if (payment.status !== 'dispatched') return
        if (payment.operationId === null) return
        if (this.pendingExecutions.has(payment.operationId)) return
        const state = await this.checkSettlement(payment.operationId)
        if (state === 'finalized') {
          await this.markPayment(id, index, () => ({ status: 'paid' }))
          return
        }
        if (state === 'rolled_back') {
          await this.markPayment(id, index, () => ({ status: 'rolled_back' }))
        }
      }),
    )
  }

  private async checkSettlement(operationId: string): Promise<string | null> {
    try {
      const result = await this.payments.checkMeltSettlement(operationId)
      return result.state
    } catch (error) {
      this.logger?.warn(
        `payout settlement check failed: ${operationId} ${error instanceof Error ? error.message : ''}`,
      )
      return null
    }
  }

  private async resumeProvider(record: SwapOutRecord): Promise<void> {
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
    record: SwapOutRecord,
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

  private async rollbackOperations(
    operations: string[],
    reason: string,
  ): Promise<Set<string>> {
    const rolledBack = new Set<string>()
    for (const operationId of operations) {
      if (this.pendingExecutions.has(operationId)) continue
      try {
        await this.payments.rollbackMelt(operationId, reason)
        rolledBack.add(operationId)
      } catch (rollbackError) {
        this.logger?.warn(
          `payout rollback failed: ${operationId} ${rollbackError instanceof Error ? rollbackError.message : ''}`,
        )
      }
    }
    return rolledBack
  }

  private async failPrepare(
    id: string,
    operations: string[],
    error: BaseError,
  ): Promise<Result<SwapOutView, BaseError>> {
    const rolledBack = await this.rollbackOperations(operations, 'prepare_failed')
    await this.persist(id, (current) => ({
      stage: 'aborted',
      phase: this.phaseFor(current, 'aborted'),
      failureReason: 'prepare_failed',
      payments: current.payments.map((payment) =>
        payment.operationId === null || rolledBack.has(payment.operationId)
          ? { ...payment, status: 'rolled_back' as const }
          : payment,
      ),
    }))
    return Err(error)
  }

  private async rollbackPrepared(record: SwapOutRecord): Promise<void> {
    const aborted = await this.persist(record.id, (current) =>
      this.canAbortUnpaid(current)
        ? {
            stage: 'aborted',
            phase: this.phaseFor(current, 'aborted'),
            failureReason: 'interrupted_before_payment',
          }
        : null,
    )
    if (aborted) await this.reconcileTerminal(aborted)
  }

  private canAbortUnpaid(record: SwapOutRecord): boolean {
    return (
      record.stage === 'quoted' &&
      !record.payments.some((payment) => payment.status === 'dispatched')
    )
  }

  private async rollbackUnpaid(operationId: string): Promise<boolean> {
    if (this.pendingExecutions.has(operationId)) return false
    try {
      await this.payments.rollbackMelt(operationId, 'payout_not_sent')
      return true
    } catch (error) {
      this.logger?.warn(
        `payout rollback failed: ${operationId} ${error instanceof Error ? error.message : ''}`,
      )
      return (await this.refreshWithTimeout(operationId)) === 'rolled_back'
    }
  }

  private async applyProgress(id: string, progress: SwapOutProgress): Promise<void> {
    await this.persist(id, (current) => {
      if (current.phase === 'settled' && progress.stage !== 'completed') {
        this.logger?.warn(`payout stage regression ignored: ${id}`)
        return null
      }
      const changes: SwapOutUpdate = {
        stage: progress.stage,
        phase: this.phaseFor(current, progress.stage),
      }
      if (progress.payoutTxId !== undefined) changes.payoutTxId = progress.payoutTxId
      changes.failureReason = progress.failureReason ?? null
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

  private async reconcileCompleted(record: SwapOutRecord): Promise<void> {
    for (let index = 0; index < record.payments.length; index++) {
      const payment = record.payments[index]
      if (payment.operationId === null) continue
      if (this.pendingExecutions.has(payment.operationId)) continue
      if (payment.status === 'paid' || payment.status === 'rolled_back') continue
      const state = await this.refreshWithTimeout(payment.operationId)
      if (state === 'finalized') {
        await this.markPayment(record.id, index, () => ({ status: 'paid' }))
        continue
      }
      if (state === 'rolled_back') {
        await this.markPayment(record.id, index, () => ({ status: 'rolled_back' }))
      }
    }
  }

  private async reconcileTerminal(record: SwapOutRecord): Promise<void> {
    for (let index = 0; index < record.payments.length; index++) {
      const payment = record.payments[index]
      if (payment.status === 'prepared') {
        if (payment.operationId !== null && !(await this.rollbackUnpaid(payment.operationId))) {
          continue
        }
        await this.markPayment(record.id, index, () => ({ status: 'rolled_back' }))
        continue
      }
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
        await this.markPayment(record.id, index, () => ({ status: 'rolled_back' }))
        continue
      }
      if (state === 'finalized') {
        await this.markPayment(record.id, index, () => ({ status: 'paid' }))
        continue
      }
      if (state === 'rolled_back') {
        await this.markPayment(record.id, index, () => ({ status: 'rolled_back' }))
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
    index: number,
    result: ExecutedRouteMelt,
  ): Promise<void> {
    if (!result.secret) return
    await this.markPayment(id, index, (payment) => ({
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
    index: number,
    patch: (payment: SwapOutPayment) => Partial<SwapOutPayment>,
  ): Promise<void> {
    await this.persist(id, (current) => {
      const payment = current.payments[index]
      if (!payment) return null
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
    record: SwapOutRecord,
    expectedVersion: number,
    changes: SwapOutUpdate,
  ): Promise<SwapOutRecord | null> {
    const updatedAt = this.now()
    const applied = await this.store.update(record.id, expectedVersion, {
      ...changes,
      updatedAt,
    })
    if (!applied) return null
    const { secrets: _secrets, ...persisted } = changes
    const next: SwapOutRecord = {
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
    mutate: (record: SwapOutRecord) => SwapOutUpdate | null,
  ): Promise<SwapOutRecord | null> {
    for (let attempt = 0; attempt < MAX_UPDATE_TRIES; attempt++) {
      const record = await this.store.get(id)
      if (!record) return null
      const changes = mutate(record)
      if (!changes) return null
      const updatedAt = this.now()
      const applied = await this.store.update(id, record.version, {
        ...changes,
        updatedAt,
      })
      if (!applied) continue
      const { secrets: _secrets, ...persisted } = changes
      const next: SwapOutRecord = {
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

  private phaseFor(record: SwapOutRecord, stage: SwapOutStage): TransferPhase {
    try {
      return advancePayoutStage(this.asTransfer(record), stage, this.now()).phase
    } catch (error) {
      this.logger?.warn(
        `payout phase guard: ${record.id} ${error instanceof Error ? error.message : ''}`,
      )
      return record.phase
    }
  }

  private asTransfer(record: SwapOutRecord): PendingTransfer {
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

  private viewOf(record: SwapOutRecord): SwapOutView {
    return {
      id: record.id,
      mintUrl: record.mintUrl,
      offerId: record.offerId ?? null,
      identifier: record.identifier ?? null,
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

  private emit(record: SwapOutRecord): void {
    this.eventBus.emit({
      type: 'swap-out:updated',
      payload: this.viewOf(record),
    })
  }
}
