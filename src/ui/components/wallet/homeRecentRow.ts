import type { TFunction } from 'i18next'
import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType, getTxMeta, getTotalCost } from '@/core/domain/transaction'
import { toNumber } from '@/core/domain/amount'
import type { PendingItem } from '@/ui/hooks/usePendingItems'
import { getTypeLabel } from './transactionHelpers'

/** The one-line home row, sourced from either the ledger or a pending item —
    home has a single history area, so both must arrive in the same shape. */
export interface HomeRecentRow {
  title: string
  createdAt: number
  amountSats: number
  isReceive: boolean
  state: 'settled' | 'pending' | 'failed'
}

export function toRecentRow(tx: Transaction, t: TFunction): HomeRecentRow {
  const meta = getTxMeta(tx)
  const typeLabel = getTypeLabel(tx, t)
  const isSwap = getTransactionType(tx) === 'swap'
  const swapFromUrl = meta.fromMintUrl ?? (tx.direction === 'send' ? tx.accountId : undefined)
  const swapToUrl = meta.toMintUrl ?? (tx.direction === 'receive' ? tx.accountId : undefined)
  // A swap's memo would read as a counterparty — the type label stays.
  const swapActive = isSwap && swapFromUrl && swapToUrl
  return {
    title: swapActive ? typeLabel : (tx.memo || typeLabel),
    createdAt: tx.createdAt,
    amountSats: toNumber(getTotalCost(tx)),
    isReceive: tx.direction === 'receive',
    state: tx.status === 'failed' ? 'failed' : tx.status === 'pending' ? 'pending' : 'settled',
  }
}

export function pendingItemToRecentRow(item: PendingItem, t: TFunction): HomeRecentRow {
  const label = item.direction === 'send'
    ? t('mintDetail.sentToken')
    : item.kind === 'token'
      ? t('mintDetail.ecashToken')
      : t('mintDetail.receiveRequest')
  return {
    title: item.memo || label,
    createdAt: item.createdAt,
    amountSats: item.amount,
    isReceive: item.direction === 'receive',
    state: 'pending',
  }
}
