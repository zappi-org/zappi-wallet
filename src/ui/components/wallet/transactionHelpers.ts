import type { Transaction } from '@/core/types'

function resolveTypeLabel(tx: Transaction, t: (key: string) => string): string {
  if (tx.type === 'swap') return t('history.swap')
  if (tx.type === 'lightning') return tx.direction === 'receive' ? t('history.lightningReceive') : t('history.lightningSend')
  if (tx.type === 'ecash-token') return t('history.ecashToken')
  if (tx.type === 'nutzap') return t('history.nutzap')
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
