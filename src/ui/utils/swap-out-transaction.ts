import type { TFunction } from 'i18next'
import type { Transaction } from '@/core/domain/transaction'
import { getDisplayFee, getTotalCost, getTransactionType } from '@/core/domain/transaction'
import { toNumber } from '@/core/domain/amount'

export interface SwapOutTransactionDetails {
  destination: string | null
  sendAmount: number | null
  receiveAmount: number | null
  identifier: string | null
  offerId: string | null
  payoutTxId: string | null
  failureReason: string | null
}

export interface SwapOutFeeBreakdown {
  providerFees: number | null
  paymentFee: number | null
  totalFee: number
  totalCost: number
  estimated: boolean
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function isSwapOutTransaction(tx: Transaction): boolean {
  return getTransactionType(tx) === 'swap-out'
}

export function getSwapOutDetails(tx: Transaction): SwapOutTransactionDetails {
  const metadata = tx.metadata ?? {}
  return {
    destination: readString(metadata.destination),
    sendAmount: readNumber(metadata.sendAmount),
    receiveAmount: readNumber(metadata.receiveAmount),
    identifier: readString(metadata.identifier),
    offerId: readString(metadata.offerId),
    payoutTxId: readString(metadata.payoutTxId),
    failureReason: readString(metadata.failureReason),
  }
}

export function shortenAddress(value: string): string {
  if (value.length <= 20) return value
  return `${value.slice(0, 10)}…${value.slice(-8)}`
}

export function isSwapOutLoss(tx: Transaction): boolean {
  return isSwapOutTransaction(tx) && tx.status === 'failed' && toNumber(getTotalCost(tx)) > 0
}

export function isListedInHistory(tx: Transaction): boolean {
  return tx.status === 'settled' || isSwapOutLoss(tx)
}

export function isShownAsPendingPayout(tx: Transaction, pendingPayoutIds: ReadonlySet<string>): boolean {
  return isSwapOutTransaction(tx) && pendingPayoutIds.has(tx.id)
}

export function withoutPendingPayouts(
  transactions: Transaction[],
  pendingPayoutIds: ReadonlySet<string>,
): Transaction[] {
  if (pendingPayoutIds.size === 0) return transactions
  return transactions.filter((tx) => !isShownAsPendingPayout(tx, pendingPayoutIds))
}

export function swapOutActionLabel(tx: Transaction, t: TFunction): string {
  if (tx.status === 'pending') return t('swapOut.record.sending')
  if (tx.status === 'failed') return t('swapOut.record.failed')
  return t('swapOut.record.sent')
}

export function swapOutRowTitle(tx: Transaction, t: TFunction): string {
  const label = swapOutActionLabel(tx, t)
  const { destination } = getSwapOutDetails(tx)
  return destination ? `${label} · ${shortenAddress(destination)}` : label
}

export function swapOutFeeBreakdown(tx: Transaction): SwapOutFeeBreakdown {
  const { sendAmount, receiveAmount } = getSwapOutDetails(tx)
  const fee = getDisplayFee(tx)
  const totalFee = fee ? toNumber(fee) : 0
  const totalCost = toNumber(getTotalCost(tx))
  const estimated = tx.status === 'pending'
  if (tx.status === 'failed') {
    return { providerFees: null, paymentFee: totalFee, totalFee, totalCost, estimated }
  }
  const providerFees =
    sendAmount !== null && receiveAmount !== null ? Math.max(0, sendAmount - receiveAmount) : null
  const paymentFee = providerFees !== null ? Math.max(0, totalFee - providerFees) : null
  return { providerFees, paymentFee, totalFee, totalCost, estimated }
}
