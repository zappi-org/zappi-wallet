//core/service/reclaim.serivce.ts
import { Err, Ok } from '@/core/domain/result'
import type { Result } from '@/core/domain/result'
import { toNumber } from '@/core/domain/amount'
import type { BaseError } from '@/core/errors/base'
import { UnknownError } from '@/core/errors/base'
import { InvalidTokenError } from '@/core/errors/cashu'
import { TokenSpentByRecipientError } from '@/core/errors/reclaim'
import {
  isClaimedSend
} from '@/core/domain/transaction';
import type { SendTokenOperator } from '@/core/ports/driven/send-token-operator.port';
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port';
import { isReclaimableSend, isReclaimed, settleAsReclaimed } from "../domain/transaction";
import type { EventBus } from '../events/event-bus';
import type { PendingOperationRepository } from "../ports/driven/pending-operation.repository.port";
import type { TokenReceiver } from "../ports/driven/token-receiver.port";
import type { ReclaimSuccess, ReclaimUseCase } from "../ports/driving/reclaim.usecase";

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
        if (errorMessage.includes("state 'finalized'")) {
          // Mark as claimed and clean up
          await this.txRepo.update(txId, {
            status: 'settled',
            outcome: 'claimed',
            completedAt: Date.now()
          })
          await this.pendingOps.delete(txId)

          // Emit events for UI update
          this.eventBus.emit({
            type: 'transactions:changed',
            payload: { reason: 'send-claimed', txId },
          })

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
      await this.markSendReclaimed(txId)
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
          return Err(new TokenSpentByRecipientError(message))
        }
        if (code === 'INVALID_TOKEN') {
          return Err(new InvalidTokenError(message))
        }
        return Err(new UnknownError(message, { code, originalError: result.error }))
      }

      await this.markSendReclaimed(txId)
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

    const opId = tx.metadata?.operationId as string | undefined
    if (opId) {
      await this.sendOp.finalizeSend(opId)
    }
  }
  async markSendReclaimed(txId: string): Promise<boolean> {

    const tx = await this.txRepo.getById(txId)

    if (!tx || !isReclaimableSend(tx)) return false

    const reclaimed = settleAsReclaimed(tx)
    await this.txRepo.update(txId, {
      status: reclaimed.status,
      outcome: reclaimed.outcome,
      completedAt: reclaimed.completedAt
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
