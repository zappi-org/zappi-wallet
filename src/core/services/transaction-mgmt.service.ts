import type { Transaction } from '@/core/domain/transaction'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type {
  TransactionMgmtUseCase
} from '@/core/ports/driving/transaction-mgmt.usecase'

export class TransactionMgmtService implements TransactionMgmtUseCase {
  constructor(
    private readonly txRepo: TransactionRepository,
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
}