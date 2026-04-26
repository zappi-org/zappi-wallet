import type {
  TransactionMgmtUseCase,
  ProofStateResult,
  ReclaimResult,
} from '@/core/ports/driving/transaction-mgmt.usecase'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { ReclaimedTokenResult, SendTokenOperator } from '@/core/ports/driven/send-token-operator.port'
import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import type { Transaction } from '@/core/domain/transaction'
import { createTransaction, settleAsDelivered, settleAsReclaimed } from '@/core/domain/transaction'

export class TransactionMgmtService implements TransactionMgmtUseCase {
  constructor(
    private readonly txRepo: TransactionRepository,
    private readonly sendOp: SendTokenOperator,
    private readonly pendingOps: PendingOperationRepository,
    private readonly eventBus: EventBus,
  ) {}

  async getById(id: string): Promise<Transaction | null> {
    return this.txRepo.getById(id)
  }

  async list(filter?: { limit?: number; offset?: number }): Promise<Transaction[]> {
    return this.txRepo.findAll(filter)
  }

  async update(id: string, data: Partial<Transaction>): Promise<void> {
    await this.txRepo.update(id, data)
  }

  async delete(id: string): Promise<void> {
    // TransactionRepository doesn't have single-delete; use update to mark as removed
    await this.txRepo.update(id, { status: 'failed', metadata: { deleted: true } })
  }

  async create(tx: Transaction): Promise<void> {
    await this.txRepo.save(tx)
  }

  async reclaimSendToken(
    txId: string,
    operationId?: string,
    token?: string,
  ): Promise<ReclaimResult> {
    const current = await this.txRepo.getById(txId)
    if (current && isReclaimedSend(current)) {
      await this.ensureReclaimReceiveTx(current)
      await this.pendingOps.delete(txId)
      return { success: true }
    }
    if (isClaimedSend(current)) {
      return { success: false, alreadySpent: true }
    }
    if (!isReclaimableSend(current)) {
      return { success: false }
    }

    if (operationId) {
      try {
        await this.sendOp.rollbackSendToken(operationId)
      } catch {
        if (await this.isRecordedReclaimed(txId)) {
          return { success: true }
        }
        return { success: false }
      }

      const recorded = await this.recordSendReclaimed(txId)
      return { success: recorded }
    }

    if (token) {
      const states = await this.sendOp.checkProofStates(token)
      if (states.allSpent) {
        await this.recordSendFinalized(txId)
        return { success: false, alreadySpent: true }
      }
      const reclaim = await this.sendOp.reclaimToken(token)
      const recorded = await this.recordSendReclaimed(txId, reclaim)
      return { success: recorded }
    }

    return { success: false }
  }

  private async isRecordedReclaimed(txId: string): Promise<boolean> {
    return isReclaimedSend(await this.txRepo.getById(txId))
  }

  async finalizeSend(txId: string, operationId?: string): Promise<void> {
    if (operationId) {
      await this.sendOp.finalizeSend(operationId)
    }
    await this.recordSendFinalized(txId)
  }

  async checkProofStates(token: string): Promise<ProofStateResult> {
    return this.sendOp.checkProofStates(token)
  }

  async recordSendFinalized(txId: string): Promise<boolean> {
    const tx = await this.txRepo.getById(txId)
    if (!isReclaimableSend(tx)) return false

    const settled = settleAsDelivered(tx)
    await this.txRepo.update(txId, {
      status: settled.status,
      outcome: settled.outcome,
      completedAt: settled.completedAt,
    })
    await this.pendingOps.delete(txId)

    this.eventBus.emit({
      type: 'payment:completed',
      payload: { txId: tx.id, method: tx.method, amount: tx.amount },
    })
    this.eventBus.emit({
      type: 'transactions:changed',
      payload: { reason: 'send-finalized', txId },
    })
    this.eventBus.emit({
      type: 'balance:changed',
      payload: { moduleId: tx.method.split(':')[0] || tx.method, accountId: tx.accountId },
    })
    return true
  }

  async recordSendReclaimed(txId: string, reclaim?: ReclaimedTokenResult): Promise<boolean> {
    const tx = await this.txRepo.getById(txId)
    if (!tx) return false
    if (isReclaimedSend(tx)) {
      await this.ensureReclaimReceiveTx(tx, reclaim)
      await this.pendingOps.delete(txId)
      return true
    }
    if (!isReclaimableSend(tx)) return false

    await this.ensureReclaimReceiveTx(tx, reclaim)
    const reclaimed = settleAsReclaimed(tx)
    await this.txRepo.update(txId, {
      status: reclaimed.status,
      outcome: reclaimed.outcome,
      completedAt: reclaimed.completedAt,
    })

    await this.pendingOps.delete(txId)
    this.eventBus.emit({
      type: 'transactions:changed',
      payload: { reason: 'send-reclaimed', txId },
    })
    this.eventBus.emit({
      type: 'balance:changed',
      payload: { moduleId: tx.method.split(':')[0] || tx.method, accountId: reclaim?.accountId ?? tx.accountId },
    })
    return true
  }

  private async ensureReclaimReceiveTx(tx: Transaction, reclaim?: ReclaimedTokenResult): Promise<void> {
    const reclaimTxId = `${tx.id}-reclaim`
    const existing = await this.txRepo.getById(reclaimTxId)
    if (existing) return

    const fee = reclaim?.fee
      ? { quoted: reclaim.fee, effective: reclaim.fee }
      : undefined
    const reclaimTx = settleAsDelivered(createTransaction({
      id: reclaimTxId,
      direction: 'receive',
      method: tx.method,
      protocol: tx.protocol,
      amount: reclaim?.amount ?? tx.amount,
      accountId: reclaim?.accountId ?? tx.accountId,
      ...(fee && { fee }),
      metadata: { reclaimedFrom: tx.id },
    }))
    await this.txRepo.save(reclaimTx)
  }
}

function isReclaimedSend(tx: Transaction | null): boolean {
  return tx?.direction === 'send' && tx.status === 'settled' && tx.outcome === 'reclaimed'
}

function isClaimedSend(tx: Transaction | null): boolean {
  return tx?.direction === 'send' && tx.status === 'settled' && tx.outcome === 'claimed'
}

function isReclaimableSend(tx: Transaction | null): tx is Transaction {
  return tx?.direction === 'send' && tx.status === 'pending' && tx.outcome === 'unclaimed'
}
