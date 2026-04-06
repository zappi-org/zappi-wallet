import type { Amount } from './amount'

export type TransactionStatus = 'pending' | 'settled' | 'failed'
export type TransactionOutcome = 'unclaimed' | 'claimed' | 'reclaimed'
export type TransactionIntent = 'swap' | 'nutzap'

export interface Transaction {
  readonly id: string
  readonly direction: 'send' | 'receive'
  readonly method: string       // adapter.id: 'cashu:lightning', 'cashu:ecash'
  readonly protocol: string     // 'bolt11', 'bolt12', 'nut18', 'cashu-token'
  readonly amount: Amount
  readonly accountId: string    // mint URL, federation ID
  readonly status: TransactionStatus
  readonly outcome?: TransactionOutcome
  readonly createdAt: number
  readonly completedAt?: number
  readonly memo?: string
  readonly intent?: TransactionIntent   // 복합 오퍼레이션 의미. 없으면 단순 송수신
  readonly linkedTxId?: string          // swap send ↔ receive 쌍 연결
  readonly metadata?: Record<string, unknown>
}

export function createTransaction(
  params: Omit<Transaction, 'status' | 'createdAt'>,
): Transaction {
  return { ...params, status: 'pending', createdAt: Date.now() }
}

export function settleAsDelivered(tx: Transaction): Transaction {
  return { ...tx, status: 'settled', outcome: 'claimed', completedAt: Date.now() }
}

export function settleAsReclaimed(tx: Transaction): Transaction {
  return { ...tx, status: 'settled', outcome: 'reclaimed', completedAt: Date.now() }
}

export function failTransaction(tx: Transaction, error?: string): Transaction {
  return {
    ...tx,
    status: 'failed',
    completedAt: Date.now(),
    metadata: { ...tx.metadata, error },
  }
}
