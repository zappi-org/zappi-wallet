import type { Amount } from './amount'

export interface Transaction {
  readonly id: string
  readonly direction: 'send' | 'receive'
  readonly method: string       // adapter.id: 'cashu:lightning', 'fedi:ecash'
  readonly protocol: string     // 'bolt11', 'bolt12', 'nut18', 'cashu-token'
  readonly amount: Amount
  readonly accountId: string    // mint URL, federation ID
  readonly status: 'pending' | 'completed' | 'failed'
  readonly createdAt: number
  readonly completedAt?: number
  readonly memo?: string
  readonly metadata?: Record<string, unknown>
}

export function createTransaction(
  params: Omit<Transaction, 'status' | 'createdAt'>,
): Transaction {
  return { ...params, status: 'pending', createdAt: Date.now() }
}

export function completeTransaction(tx: Transaction): Transaction {
  return { ...tx, status: 'completed', completedAt: Date.now() }
}

export function failTransaction(tx: Transaction, error?: string): Transaction {
  return {
    ...tx,
    status: 'failed',
    completedAt: Date.now(),
    metadata: { ...tx.metadata, error },
  }
}
