import type {
  TransactionMgmtUseCase,
  ProofStateResult,
  ReclaimResult,
} from '@/core/ports/driving/transaction-mgmt.usecase'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { SendTokenOperator } from '@/core/ports/driven/send-token-operator.port'
import type { Transaction } from '@/core/domain/transaction'

export class TransactionMgmtService implements TransactionMgmtUseCase {
  constructor(
    private readonly txRepo: TransactionRepository,
    private readonly sendOp: SendTokenOperator,
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
    if (operationId) {
      try {
        await this.sendOp.rollbackSendToken(operationId)
        await this.sendOp.markSendReclaimed(txId)
        return { success: true }
      } catch {
        return { success: false }
      }
    }

    if (token) {
      const states = await this.sendOp.checkProofStates(token)
      if (states.allSpent) {
        await this.sendOp.markSendFinalized(txId)
        return { success: false, alreadySpent: true }
      }
      try {
        await this.sendOp.markSendReclaimed(txId)
        return { success: true }
      } catch {
        return { success: false }
      }
    }

    return { success: false }
  }

  async finalizeSend(txId: string, operationId?: string): Promise<void> {
    if (operationId) {
      await this.sendOp.finalizeSend(operationId)
    }
    await this.sendOp.markSendFinalized(txId)
  }

  async checkProofStates(token: string): Promise<ProofStateResult> {
    return this.sendOp.checkProofStates(token)
  }
}
