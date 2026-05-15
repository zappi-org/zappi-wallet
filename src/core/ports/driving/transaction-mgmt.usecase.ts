import type { Transaction } from '@/core/domain/transaction';

export interface ReclaimResult {
  success: boolean
  amount?: number
  alreadySpent?: boolean
  errorCode?: string
}

export interface TransactionMgmtUseCase {
  getById(id: string): Promise<Transaction | null>
  list(filter?: { limit?: number; offset?: number }): Promise<Transaction[]>
  update(id: string, data: Partial<Transaction>): Promise<void>
  delete(id: string): Promise<void>
  create(tx: Transaction): Promise<void>
}
