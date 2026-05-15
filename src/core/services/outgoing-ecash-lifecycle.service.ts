import { toNumber } from '@/core/domain/amount'
import {
  applyClaimCheckResult,
  applyDeliveryResult,
  canReclaimOutgoingEcash,
  createOutgoingEcashOperation,
  deriveOutgoingEcashDisplayState,
  isOpenOutgoingEcash,
  markClaimed,
  markReclaimed,
  type OutgoingDeliveryResult,
  type OutgoingDeliveryState,
  type OutgoingEcashOperation,
  type OutgoingEcashOperationKind,
} from '@/core/domain/outgoing-ecash-lifecycle'
import { OUTGOING_ECASH_SYNC } from '@/core/constants'
import { getTransactionType, getTxMeta } from '@/core/domain/transaction'
import type { Transaction } from '@/core/domain/transaction'
import type { EventBus } from '@/core/events/event-bus'
import type { OutgoingClaimStateProbe } from '@/core/ports/driven/outgoing-claim-state-probe.port'
import type { OutgoingEcashOperationStore } from '@/core/ports/driven/outgoing-ecash-operation-store.port'
import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { SendTokenOperator } from '@/core/ports/driven/send-token-operator.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type {
  OutgoingEcashLifecycleUseCase,
  OutgoingEcashStatus,
} from '@/core/ports/driving/outgoing-ecash-lifecycle.usecase'

export class OutgoingEcashLifecycleService implements OutgoingEcashLifecycleUseCase {
  constructor(
    private readonly store: OutgoingEcashOperationStore,
    private readonly txRepo: TransactionRepository,
    private readonly claimProbe: OutgoingClaimStateProbe,
    private readonly eventBus: EventBus,
    private readonly sendTokenOperator?: Pick<SendTokenOperator, 'finalizeSend'>,
    private readonly pendingOps?: Pick<PendingOperationRepository, 'delete'>,
  ) {}

  async recordCreated(params: {
    txId: string
    kind: OutgoingEcashOperationKind
    accountId: string
    amount: number
    token?: string
    operationId?: string
    delivery: OutgoingDeliveryState
  }): Promise<void> {
    const existing = await this.store.getByTxId(params.txId)
    if (existing) {
      const updated: OutgoingEcashOperation = {
        ...existing,
        token: existing.token ?? params.token,
        operationId: existing.operationId ?? params.operationId,
        updatedAt: Date.now(),
      }
      if (updated.token !== existing.token || updated.operationId !== existing.operationId) {
        await this.store.save(updated)
      }
      return
    }

    await this.store.save(createOutgoingEcashOperation({
      ...params,
      now: Date.now(),
    }))
  }

  async recordDeliveryResult(txId: string, result: OutgoingDeliveryResult): Promise<OutgoingEcashStatus | null> {
    const operation = await this.ensureOperation(txId)
    if (!operation) return null

    const next = applyDeliveryResult(operation, result, Date.now())
    if (next !== operation) {
      await this.store.save(next)
      this.emitTransactionChanged(txId, 'outgoing-delivery-updated')
    }
    return this.toStatus(next)
  }

  async getStatus(txId: string): Promise<OutgoingEcashStatus | null> {
    const operation = await this.ensureOperation(txId)
    return operation ? this.toStatus(operation) : null
  }

  async checkStatus(txId: string): Promise<OutgoingEcashStatus | null> {
    let operation = await this.ensureOperation(txId)
    if (!operation || !isOpenOutgoingEcash(operation)) {
      return operation ? this.toStatus(operation) : null
    }

    operation = await this.recoverStalePendingPublish(operation)

    const result = await this.claimProbe.checkClaimState({
      token: operation.token,
      operationId: operation.operationId,
    })
    const next = applyClaimCheckResult(operation, result, Date.now())
    await this.store.save(next)
    await this.applyClaimToTransaction(next)
    return this.toStatus(next)
  }

  async reconcileOpen(): Promise<{ checked: number; claimed: number; failed: number }> {
    const openByTxId = new Map<string, OutgoingEcashOperation>()
    for (const operation of await this.store.listOpen()) {
      openByTxId.set(operation.txId, operation)
    }
    for (const tx of await this.txRepo.list({ status: 'pending', outcome: 'unclaimed', direction: 'send' })) {
      const operation = await this.ensureOperation(tx.id)
      if (operation && isOpenOutgoingEcash(operation)) {
        openByTxId.set(operation.txId, operation)
      }
    }
    const open = [...openByTxId.values()]
    let checked = 0
    let claimed = 0
    let failed = 0

    for (const operation of open) {
      try {
        const status = await this.checkStatus(operation.txId)
        if (!status) continue
        checked++
        if (status.operation.claim === 'claimed') claimed++
        if (status.operation.claim === 'check_failed') failed++
      } catch {
        failed++
      }
    }

    return { checked, claimed, failed }
  }

  async markClaimed(txId: string): Promise<void> {
    const operation = await this.ensureOperation(txId)
    if (!operation) return
    if (operation.claim === 'claimed' || operation.claim === 'reclaimed') return

    const next = markClaimed(operation, Date.now())
    await this.store.save(next)
    await this.applyClaimToTransaction(next, { finalizeSend: false })
  }

  async markReclaimed(txId: string): Promise<void> {
    const operation = await this.ensureOperation(txId)
    if (!operation) return
    if (operation.claim === 'claimed' || operation.claim === 'reclaimed') return

    const next = markReclaimed(operation, Date.now())
    await this.store.save(next)
    await this.applyClaimToTransaction(next, { finalizeSend: false })
  }

  private async ensureOperation(txId: string): Promise<OutgoingEcashOperation | null> {
    const existing = await this.store.getByTxId(txId)
    if (existing) return existing

    const tx = await this.txRepo.getById(txId)
    if (!tx || !isOutgoingEcashTx(tx)) return null

    const meta = getTxMeta(tx)
    const kind = isDirectNostrTx(tx) ? 'direct-nostr-send' : 'token-create'
    const delivery: OutgoingDeliveryState = kind === 'direct-nostr-send' ? 'unknown' : 'not_required'
    const operation = createOutgoingEcashOperation({
      txId: tx.id,
      kind,
      accountId: tx.accountId,
      amount: toNumber(tx.amount),
      token: meta.token,
      operationId: meta.operationId,
      delivery,
      now: tx.createdAt,
    })
    await this.store.save(operation)
    return operation
  }

  private async recoverStalePendingPublish(
    operation: OutgoingEcashOperation,
  ): Promise<OutgoingEcashOperation> {
    if (operation.delivery !== 'pending_publish') return operation
    if (!operation.token) return operation
    if (Date.now() - operation.updatedAt < OUTGOING_ECASH_SYNC.PENDING_PUBLISH_STALE_MS) {
      return operation
    }

    const next = applyDeliveryResult(operation, 'unknown', Date.now())
    await this.store.save(next)
    this.emitTransactionChanged(operation.txId, 'outgoing-publish-stale')
    return next
  }

  private async applyClaimToTransaction(
    operation: OutgoingEcashOperation,
    options: { finalizeSend: boolean } = { finalizeSend: true },
  ): Promise<void> {
    if (operation.claim !== 'claimed' && operation.claim !== 'reclaimed') {
      this.emitTransactionChanged(operation.txId, 'outgoing-status-checked')
      return
    }

    const tx = await this.txRepo.getById(operation.txId)
    if (!tx) return
    const completedAt = Date.now()

    if (operation.claim === 'claimed') {
      if (options.finalizeSend && operation.operationId) {
        await this.sendTokenOperator?.finalizeSend(operation.operationId).catch(() => {})
      }
      await this.pendingOps?.delete(operation.txId).catch(() => {})
      await this.txRepo.update(tx.id, {
        status: 'settled',
        outcome: 'claimed',
        completedAt,
      })
      this.eventBus.emit({
        type: 'send:claimed',
        payload: {
          txId: tx.id,
          method: tx.method,
          protocol: tx.protocol,
          amount: tx.amount,
          memo: tx.memo,
        },
      })
      this.emitTransactionChanged(tx.id, 'send-claimed')
      return
    }

    await this.txRepo.update(tx.id, {
      status: 'settled',
      outcome: 'reclaimed',
      completedAt,
    })
    await this.pendingOps?.delete(operation.txId).catch(() => {})
    this.eventBus.emit({
      type: 'send:reclaimed',
      payload: {
        txId: tx.id,
        method: tx.method,
        protocol: tx.protocol,
        amount: tx.amount,
      },
    })
    this.emitTransactionChanged(tx.id, 'send-reclaimed')
  }

  private toStatus(operation: OutgoingEcashOperation): OutgoingEcashStatus {
    return {
      operation,
      displayState: deriveOutgoingEcashDisplayState(operation),
      canReclaim: canReclaimOutgoingEcash(operation),
    }
  }

  private emitTransactionChanged(txId: string, reason: string): void {
    this.eventBus.emit({
      type: 'transactions:changed',
      payload: { reason, txId },
    })
  }
}

function isOutgoingEcashTx(tx: Transaction): boolean {
  return (
    tx.direction === 'send' &&
    tx.status === 'pending' &&
    tx.outcome === 'unclaimed' &&
    (getTransactionType(tx) === 'ecash' || getTransactionType(tx) === 'ecash-token')
  )
}

function isDirectNostrTx(tx: Transaction): boolean {
  const type = getTxMeta(tx).counterpartyAddressType
  return type === 'npub' || type === 'nprofile'
}
