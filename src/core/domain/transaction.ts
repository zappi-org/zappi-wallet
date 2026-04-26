import type { Amount } from './amount'
import { add } from './amount'

export type TransactionStatus = 'pending' | 'settled' | 'failed'
export type TransactionOutcome = 'unclaimed' | 'claimed' | 'reclaimed'
export type TransactionIntent = 'swap' | 'nutzap' | 'request-fulfill'

/** Display currency snapshot — records the exchange rate at transaction time */
export interface DisplaySnapshot {
  readonly amount: number
  readonly currency: string
  readonly rate: number
}

/** Transaction fee — protocol-neutral fee model */
export interface TransactionFee {
  readonly quoted: Amount       // prepare-time estimated fee
  readonly effective?: Amount   // actual fee after finalization (if known)
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
  readonly expiresAt?: number
  readonly memo?: string
  readonly intent?: TransactionIntent
  readonly linkedTxId?: string
  readonly displaySnapshot?: DisplaySnapshot
  readonly fee?: TransactionFee
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

/** Get the display fee — effective if available, otherwise quoted */
export function getDisplayFee(tx: Transaction): Amount | undefined {
  if (!tx.fee) return undefined
  return tx.fee.effective ?? tx.fee.quoted
}

/**
 * Get the total cost for display purposes.
 * - send: amount + fee
 * - receive: amount (already net after fees)
 */
export function getTotalCost(tx: Transaction): Amount {
  const fee = getDisplayFee(tx)
  if (!fee) return tx.amount
  if (tx.direction === 'send') return add(tx.amount, fee)
  return tx.amount
}
