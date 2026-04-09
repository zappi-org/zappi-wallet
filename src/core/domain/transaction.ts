import type { Amount } from './amount'

export type TransactionStatus = 'pending' | 'settled' | 'failed'
export type TransactionOutcome = 'unclaimed' | 'claimed' | 'reclaimed'
export type TransactionIntent = 'swap' | 'nutzap'

/** Display currency snapshot — records the exchange rate at transaction time */
export interface DisplaySnapshot {
  readonly amount: number
  readonly currency: string
  readonly rate: number
}

/**
 * Domain Transaction — the canonical entity used across all layers.
 *
 * DexieTransactionRepository handles domain <-> DB record conversion.
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
  readonly displaySnapshot?: DisplaySnapshot
  readonly metadata?: Record<string, unknown>
}

// ─── UI helper types ───

export type TransactionType = 'lightning' | 'ecash' | 'ecash-token' | 'nutzap' | 'swap'

/** Derive display type from method + protocol + intent */
export function getTransactionType(tx: Transaction): TransactionType {
  if (tx.intent === 'swap') return 'swap'
  if (tx.protocol === 'bolt11') return 'lightning'
  if (tx.protocol === 'nut18') return 'ecash'
  if (tx.protocol === 'cashu-token' && tx.intent === 'nutzap') return 'nutzap'
  if (tx.protocol === 'cashu-token') return 'ecash-token'
  return 'lightning'
}

/** Extract legacy flat fields from metadata (for TransactionDetail etc.) */
export function getTxMeta(tx: Transaction) {
  const m = tx.metadata ?? {}
  return {
    token: m.token as string | undefined,
    bolt11: m.bolt11 as string | undefined,
    preimage: m.preimage as string | undefined,
    operationId: m.operationId as string | undefined,
    tokenState: m.tokenState as string | undefined,
    source: m.source as string | undefined,
    fromMintUrl: m.fromMintUrl as string | undefined,
    toMintUrl: m.toMintUrl as string | undefined,
    fee: m.fee as number | undefined,
    reclaimedFrom: m.reclaimedFrom as string | undefined,
    destination: m.destination as string | undefined,
  }
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
