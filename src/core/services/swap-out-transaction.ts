import { sat } from '@/core/domain/amount'
import { isPayoutStageTerminal, isSwapOutStageResumable } from '@/core/domain/swap-out'
import type { Transaction, TransactionStatus } from '@/core/domain/transaction'
import type { SwapOutRecord } from '@/core/ports/driven/swap-out-store.port'

export function reachedDispatch(record: SwapOutRecord): boolean {
  if (record.dispatchedAt != null) return true
  if (isSwapOutStageResumable(record.stage)) return true
  if (record.stage === 'completed' || record.stage === 'refunded') return true
  return record.payments.some((payment) => payment.status === 'paid')
}

export function isRecorded(existing: Transaction | null, next: Transaction): boolean {
  if (existing === null) return false
  if (next.status === 'pending') return true
  return (
    existing.status === next.status &&
    existing.amount.value === next.amount.value &&
    existing.completedAt === next.completedAt &&
    (existing.fee?.effective ?? existing.fee?.quoted)?.value ===
      (next.fee?.effective ?? next.fee?.quoted)?.value &&
    existing.metadata?.payoutTxId === next.metadata?.payoutTxId
  )
}

export function transactionFor(
  record: SwapOutRecord,
  existing: Transaction | null,
): Transaction {
  const paid = record.payments.filter((payment) => payment.status === 'paid')
  const fixedFee = record.sendAmount - record.receiveAmount
  const quoted =
    fixedFee + record.payments.reduce((sum, payment) => sum + payment.feeReserve, 0)
  const status: TransactionStatus =
    record.stage === 'completed'
      ? 'settled'
      : isPayoutStageTerminal(record.stage)
        ? 'failed'
        : 'pending'
  const paidFees = paid.reduce((sum, payment) => sum + (payment.feePaid ?? 0), 0)
  const amount =
    status === 'failed'
      ? paid.reduce((sum, payment) => sum + payment.amount, 0)
      : record.receiveAmount
  const effective = record.stage === 'completed' ? fixedFee + paidFees : paidFees
  const metadata: Record<string, unknown> = {
    sendAmount: record.sendAmount,
    receiveAmount: record.receiveAmount,
    destination: record.destination,
    identifier: record.identifier,
    offerId: record.offerId,
  }
  if (record.payoutTxId !== null) metadata.payoutTxId = record.payoutTxId
  if (record.failureReason !== null) metadata.failureReason = record.failureReason
  const transaction: Transaction = {
    id: record.id,
    direction: 'send',
    method: 'swap-out',
    protocol: 'swap-out',
    amount: sat(amount),
    accountId: record.mintUrl,
    status,
    createdAt: record.createdAt,
    fee:
      status === 'pending'
        ? { quoted: sat(quoted) }
        : { quoted: sat(quoted), effective: sat(effective) },
    metadata,
  }
  return status === 'pending'
    ? transaction
    : { ...transaction, completedAt: completedAt(record, existing) }
}

export function completedAt(
  record: SwapOutRecord,
  existing: Transaction | null,
): number {
  if (existing !== null && existing.status !== 'pending' && existing.completedAt !== undefined) {
    return existing.completedAt
  }
  return record.updatedAt
}
