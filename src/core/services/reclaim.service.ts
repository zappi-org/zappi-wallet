//core/service/reclaim.serivce.ts
import { Err, Ok } from '@/core/domain/result'
import type { Result } from '@/core/domain/result'
import { toNumber } from '@/core/domain/amount'
import type { BaseError } from '@/core/errors/base'
import { UnknownError } from '@/core/errors/base'
import { InvalidTokenError } from '@/core/errors/cashu'
import { TokenSpentByRecipientError } from '@/core/errors/reclaim'
import {
  isClaimedSend,
  isReclaimableSend,
  isReclaimed,
  settleAsDelivered,
  settleAsReclaimed,
  type Transaction,
} from '@/core/domain/transaction'
import type { SendTokenOperator } from '@/core/ports/driven/send-token-operator.port';
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port';
import type { EventBus } from '../events/event-bus';
import type { PendingOperationRepository } from "../ports/driven/pending-operation.repository.port";
import type { TokenReceiver } from "../ports/driven/token-receiver.port";
import type { ReclaimSuccess, ReclaimUseCase } from "../ports/driving/reclaim.usecase";

function isAlreadyFinalizedMessage(message: string): boolean {
  return message.toLowerCase().includes("state 'finalized'")
}

export class ReclaimService implements ReclaimUseCase {
  constructor(
    private readonly txRepo: TransactionRepository,
    private readonly sendOp: SendTokenOperator,
    private readonly tokenReceiver: TokenReceiver,
    private readonly pendingOps: PendingOperationRepository,
    private readonly eventBus: EventBus,
  ) { }

  async reclaim(txId: string): Promise<Result<ReclaimSuccess, BaseError>> {
    const tx = await this.txRepo.getById(txId)

    const txDebugInfo = tx
      ? { status: tx.status, outcome: tx.outcome }
      : { status: undefined, outcome: undefined }

    // Check domain state - already reclaimed
    if (tx && isReclaimed(tx)) {
      await this.pendingOps.delete(txId)
      // The stale pending entry just left the store — without this event the
      // pending UIs keep showing the card until an unrelated refresh.
      this.eventBus.emit({
        type: 'transactions:changed',
        payload: { reason: 'send-reclaimed', txId },
      })
      return Ok({
        amount: { value: toNumber(tx.amount), unit: tx.amount.unit || 'sat' },
        accountId: tx.accountId
      })
    }

    // Already spent
    if (tx && isClaimedSend(tx)) {
      return Err(new TokenSpentByRecipientError('Token has already been claimed by recipient'))
    }

    if (!isReclaimableSend(tx)) {
      return Err(new UnknownError(
        'Transaction cannot be reclaimed',
        { txId, ...txDebugInfo }
      ))
    }

    const opId = tx.metadata?.operationId as string | undefined
    const token = tx.metadata?.token as string | undefined

    // By operationId
    if (opId) {
      try {
        await this.sendOp.rollbackSendToken(opId)
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)

        // Check if already finalized (recipient already claimed)
        if (isAlreadyFinalizedMessage(errorMessage)) {
          await this.markSendClaimed(tx)
          return Err(new TokenSpentByRecipientError('Token has already been claimed by recipient'))
        }

        const txAgain = await this.txRepo.getById(txId)
        if (txAgain && isReclaimed(txAgain)) {
          return Ok({
            amount: { value: toNumber(tx.amount), unit: tx.amount.unit || 'sat' },
            accountId: tx.accountId
          })
        }
        return Err(new UnknownError(
          'Failed to rollback send operation',
          error
        ))
      }
      // TokenReceiver already made receive TX
      // Not making companion TX, just update send TX
      await this.markSendReclaimed(txId, 0)
      return Ok({
        amount: { value: toNumber(tx.amount), unit: tx.amount.unit || 'sat' },
        accountId: tx.accountId
      })
    }

    // By token
    if (token) {
      const result = await this.tokenReceiver.receiveToken(token)
      if (!result.ok) {
        const { code, message } = result.error

        if (code === 'TOKEN_SPENT') {
          // The recipient beat the reclaim — settle as claimed and emit, so
          // pending UIs drop the card instead of trusting a local screen flip.
          // Re-read first: a concurrent reclaim may already have settled the
          // row, and a stale write here would flip reclaimed → claimed.
          const fresh = await this.txRepo.getById(txId)
          if (fresh && isReclaimableSend(fresh)) {
            await this.markSendClaimed(fresh)
          }
          return Err(new TokenSpentByRecipientError(message))
        }
        if (code === 'INVALID_TOKEN') {
          return Err(new InvalidTokenError(message))
        }
        return Err(new UnknownError(message, { code, originalError: result.error }))
      }

      // The receive result is what actually landed — the difference is the
      // one true reclaim fee, persisted so the archive never has to guess.
      const reclaimFee = Math.max(0, toNumber(tx.amount) - result.value.amount)
      await this.markSendReclaimed(txId, reclaimFee)
      return Ok({
        amount: { value: toNumber(tx.amount), unit: tx.amount.unit || 'sat' },
        accountId: tx.accountId
      })
    }

    return Err(new UnknownError(
      'No operation ID or token found for reclaim',
      { txId }
    ))
  }
  async finalizeSend(txId: string): Promise<void> {
    const tx = await this.txRepo.getById(txId)
    if (!tx) return
    if (isClaimedSend(tx) || isReclaimed(tx)) return
    if (!isReclaimableSend(tx)) return

    const opId = tx.metadata?.operationId as string | undefined
    if (!opId) return

    try {
      await this.sendOp.finalizeSend(opId)
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      if (!isAlreadyFinalizedMessage(errorMessage)) {
        throw error
      }
    }

    await this.markSendClaimed(tx)
  }

  private async markSendClaimed(tx: Transaction): Promise<void> {
    const settled = settleAsDelivered(tx)
    await this.txRepo.update(tx.id, {
      status: settled.status,
      outcome: settled.outcome,
      completedAt: settled.completedAt
    })
    await this.pendingOps.delete(tx.id)

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

    this.eventBus.emit({
      type: 'transactions:changed',
      payload: { reason: 'send-claimed', txId: tx.id },
    })

    this.eventBus.emit({
      type: 'balance:changed',
      payload: {
        moduleId: tx.method.split(':')[0] || tx.method,
        accountId: tx.accountId,
      },
    })
  }

  async markSendReclaimed(txId: string, reclaimFee?: number): Promise<boolean> {

    const tx = await this.txRepo.getById(txId)

    if (!tx || !isReclaimableSend(tx)) return false

    const reclaimed = settleAsReclaimed(tx)
    await this.txRepo.update(txId, {
      status: reclaimed.status,
      outcome: reclaimed.outcome,
      completedAt: reclaimed.completedAt,
      ...(reclaimFee != null
        ? { metadata: { ...tx.metadata, reclaimFee } }
        : {})
    })

    await this.pendingOps.delete(txId)
    this.eventBus.emit({
      type: 'transactions:changed',
      payload: { reason: 'send-reclaimed', txId },
    })

    this.eventBus.emit({
      type: 'balance:changed',
      payload: {
        moduleId: tx.method.split(':')[0] || tx.method,
        accountId: tx.accountId,
      },
    })
    return true;
  }
}
