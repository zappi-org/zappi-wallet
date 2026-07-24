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

// Coco's SendOpsApi rejects a non-pending rollback with
// "Cannot reclaim operation in state '<state>'. Expected 'pending'." — a
// rolled_back op means the money is already back, so the retry is a no-op,
// not a failure. 'rolling_back' is deliberately excluded: that swap is still
// in flight and has not yet returned the proofs.
function isAlreadyRolledBackMessage(message: string): boolean {
  return message.toLowerCase().includes("state 'rolled_back'")
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

        // A crash between coco's rollback and the ledger write leaves the money
        // back in the wallet while the row still says pending — the retry must
        // finish the ledger side instead of stranding the row on UnknownError.
        if (isAlreadyRolledBackMessage(errorMessage)) {
          await this.markSendReclaimed(txId)
          return Ok({
            amount: { value: toNumber(tx.amount), unit: tx.amount.unit || 'sat' },
            accountId: tx.accountId
          })
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
      // Rollback returns proofs to the sender's own balance — no ledger
      // receive TX is created, so only the send TX needs updating here.
      // Rollback may still cost input fees inside the SDK — with no measured
      // value, persist no fee rather than a confident zero.
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

      // Mark the receive TX as a reclaim, not a plain receive, so History
      // and the receipt don't misrepresent money coming back as new money in.
      // Best-effort: this is a cosmetic label, so a storage failure here must
      // not stop markSendReclaimed below from running — the alternative is a
      // send stuck reclaimable forever, and a retry re-spending the same token.
      const receiveTxId = result.value.transactionId
      // Only a companion that actually got stamped may silence the send row —
      // if the stamp failed the send row stays the sole 되찾음 row.
      let companionTxId: string | undefined
      try {
        const receiveTx = await this.txRepo.getById(receiveTxId)
        if (receiveTx) {
          await this.txRepo.update(receiveTxId, {
            metadata: { ...receiveTx.metadata, reclaimedFrom: txId },
          })
          companionTxId = receiveTxId
        }
      } catch {
        // Swallow — the receive row just shows as a plain receive.
      }

      // The receive result is what actually landed — the difference is the
      // one true reclaim fee, persisted so the archive never has to guess.
      const reclaimFee = Math.max(0, toNumber(tx.amount) - result.value.amount)
      await this.markSendReclaimed(txId, reclaimFee, companionTxId)
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

  async markSendReclaimed(txId: string, reclaimFee?: number, companionTxId?: string): Promise<boolean> {

    const tx = await this.txRepo.getById(txId)

    if (!tx || !isReclaimableSend(tx)) return false

    const reclaimed = settleAsReclaimed(tx)
    const metadataPatch = {
      ...(reclaimFee != null ? { reclaimFee } : {}),
      // Marks this send as the silent half of a two-row reclaim so History
      // shows the companion receive row's 되찾음 only once.
      ...(companionTxId != null ? { reclaimCompanionTxId: companionTxId } : {}),
    }
    await this.txRepo.update(txId, {
      status: reclaimed.status,
      outcome: reclaimed.outcome,
      completedAt: reclaimed.completedAt,
      ...(Object.keys(metadataPatch).length > 0
        ? { metadata: { ...tx.metadata, ...metadataPatch } }
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
