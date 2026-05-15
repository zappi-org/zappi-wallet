import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType, getTxMeta } from '@/core/domain/transaction'
import { isNpubTransaction } from '@/ui/utils/transaction-display'
export { isNpubTransaction } from '@/ui/utils/transaction-display'

function resolveTypeLabel(tx: Transaction, t: (key: string) => string): string {
  if (isNpubTransaction(tx)) {
    return tx.direction === 'receive' ? t('history.npubReceive') : t('history.npubSend')
  }

  const txType = getTransactionType(tx)
  if (txType === 'swap') return t('history.swap')
  if (txType === 'lightning') return tx.direction === 'receive' ? t('history.lightningReceive') : t('history.lightningSend')
  if (txType === 'ecash-token') {
    if (getTxMeta(tx).reclaimedFrom) return t('history.ecashReclaim')
    if (tx.intent === 'request-fulfill') return t('history.requestFulfill')
    if (tx.intent === 'request-pay') return t('history.requestPay')
    return tx.direction === 'receive' ? t('history.ecashRegister') : t('history.ecashToken')
  }
  if (txType === 'nutzap') return t('history.nutzap')
  return tx.direction === 'receive' ? t('history.ecashReceive') : t('history.ecashSend')
}

/** Display title: memo first, then type label */
export function getTitle(tx: Transaction, t: (key: string) => string): string {
  return tx.memo || resolveTypeLabel(tx, t)
}

/** Type label only (no memo) — for subtitles and search */
export function getTypeLabel(tx: Transaction, t: (key: string) => string): string {
  return resolveTypeLabel(tx, t)
}
