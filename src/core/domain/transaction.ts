import type { Amount } from './amount'

export type TransactionStatus = 'pending' | 'settled' | 'failed'
export type TransactionOutcome = 'unclaimed' | 'claimed' | 'reclaimed'
export type TransactionIntent = 'swap' | 'nutzap'

/**
 * Domain Transaction — business logic representation.
 *
 * This is the canonical domain entity used by core services, ports, and adapters.
 * UI/store/composition use the DB record type (core/types/wallet.ts Transaction)
 * which has flat fields (amount: number, mintUrl, status: 'completed').
 *
 * DexieTransactionRepository handles domain <-> DB record conversion.
 * These are NOT duplicates — they serve different purposes:
 *   - Domain: Amount type, method/protocol separation, immutable
 *   - DB Record: flat number amount, legacy field names, mutable
 */
export interface Transaction {
  readonly id: string
  readonly direction: 'send' | 'receive'
  readonly method: string
  readonly protocol: string
  readonly amount: Amount
  readonly accountId: string
  readonly status: TransactionStatus
  readonly outcome?: TransactionOutcome
  readonly createdAt: number
  readonly completedAt?: number
  readonly memo?: string
  readonly intent?: TransactionIntent
  readonly linkedTxId?: string
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
