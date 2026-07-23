import type { TFunction } from 'i18next'
import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType, getTxMeta, isReclaimableSend } from '@/core/domain/transaction'

// Title = the ACT (받음/보냄/되찾음); means lives in the subtitle,
// lifecycle in the detail's state bar. Matches the history filter axis.
// failed keeps the act label — strikethrough+red dot already carry failure.
function resolveActionLabel(tx: Transaction, t: TFunction): string {
  const meta = getTxMeta(tx)
  if (meta.reclaimedFrom) return t('history.reclaimed')
  const isReceive = tx.direction === 'receive'
  if (tx.status === 'pending') {
    if (!isReceive && isReclaimableSend(tx)) return t('send.receipt.pendingTitle')
    return t(isReceive ? 'history.receiving' : 'history.sending')
  }
  return t(isReceive ? 'history.received' : 'history.sent')
}

/** Display title: the act label, with the memo trailing it (CSS truncates). */
export function getTitle(tx: Transaction, t: TFunction): string {
  const label = resolveActionLabel(tx, t)
  return tx.memo ? `${label} · ${tx.memo}` : label
}

/** Means label only (no memo) — for subtitles and search */
export function getTypeLabel(tx: Transaction, t: TFunction): string {
  const txType = getTransactionType(tx)
  if (txType === 'swap') return t('history.swap')
  if (txType === 'lightning') return t('history.lightning')
  if (txType === 'nutzap') return t('history.nutzap')
  return t('history.ecash')
}
