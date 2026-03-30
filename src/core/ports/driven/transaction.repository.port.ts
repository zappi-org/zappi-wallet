import type { Transaction } from '@/core/domain/transaction'

export interface TransactionRepository {
  save(tx: Transaction): Promise<void>
  getById(id: string): Promise<Transaction | null>
  list(filter?: TransactionFilter): Promise<Transaction[]>
  update(id: string, patch: Partial<Transaction>): Promise<void>
}

export interface TransactionFilter {
  direction?: 'send' | 'receive'
  status?: 'pending' | 'completed' | 'failed'
  accountId?: string
  limit?: number
  offset?: number
}
