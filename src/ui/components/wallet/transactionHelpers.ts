import type { TFunction } from 'i18next'
import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType } from '@/core/domain/transaction'

// Labels name the MEANS only — direction lives in the amount's sign/color and
// the row icon, and the lifecycle story lives in the detail's state bar.
function resolveTypeLabel(tx: Transaction, t: TFunction): string {
  const txType = getTransactionType(tx)
  if (txType === 'swap') return t('history.swap')
  if (txType === 'lightning') return t('history.lightning')
  if (txType === 'nutzap') return t('history.nutzap')
  return t('history.ecash')
}

/** Display title: the means label, with the memo trailing it (CSS truncates). */
export function getTitle(tx: Transaction, t: TFunction): string {
  const label = resolveTypeLabel(tx, t)
  return tx.memo ? `${label} · ${tx.memo}` : label
}

/** Type label only (no memo) — for subtitles and search */
export function getTypeLabel(tx: Transaction, t: TFunction): string {
  return resolveTypeLabel(tx, t)
}
