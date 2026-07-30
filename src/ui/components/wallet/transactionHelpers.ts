import type { TFunction } from 'i18next'
import type { Transaction } from '@/core/domain/transaction'
import { getTransactionType, getTxMeta, isReclaimableSend, isReclaimed } from '@/core/domain/transaction'

/**
 * Send ids whose reclaim was booked on a companion receive row (legacy token
 * path). Derived from the rows themselves, so it holds for reclaims written
 * long before any marker existed — pass the FULL set, not the visible slice.
 */
export function collectReclaimCompanionSendIds(all: Transaction[]): Set<string> {
  const ids = new Set<string>()
  for (const tx of all) {
    const { reclaimedFrom } = getTxMeta(tx)
    if (reclaimedFrom) ids.add(reclaimedFrom)
  }
  return ids
}

/**
 * A reclaim reaches the ledger in two shapes and each must read as 되찾음 exactly
 * once: the legacy token path stamps `reclaimedFrom` on a companion receive row,
 * while the operationId rollback path settles the send row itself as reclaimed
 * and writes no receive row at all.
 *
 * `hasCompanionReceive` comes from collectReclaimCompanionSendIds over the
 * caller's full set; false is the safe default because it keeps the reclaim
 * visible on the send row rather than hiding it from both halves.
 */
export function isReclaimRow(tx: Transaction, hasCompanionReceive = false): boolean {
  if (getTxMeta(tx).reclaimedFrom) return true
  // The companion receive row is already this reclaim's 되찾음 row, so the send
  // row keeps its own directional presentation — one 되찾음 per reclaim.
  return isReclaimed(tx) && !hasCompanionReceive
}

// Title = the ACT (받음/보냄/되찾음); means lives in the subtitle,
// lifecycle in the detail's state bar. Matches the history filter axis.
// failed keeps the act label — strikethrough+red dot already carry failure.
function resolveActionLabel(tx: Transaction, t: TFunction, hasCompanionReceive: boolean): string {
  if (isReclaimRow(tx, hasCompanionReceive)) return t('history.reclaimed')
  const isReceive = tx.direction === 'receive'
  if (tx.status === 'pending') {
    if (!isReceive && isReclaimableSend(tx)) return t('send.receipt.pendingTitle')
    return t(isReceive ? 'history.receiving' : 'history.sending')
  }
  return t(isReceive ? 'history.received' : 'history.sent')
}

/** Display title: the act label, with the memo trailing it (CSS truncates). */
export function getTitle(tx: Transaction, t: TFunction, hasCompanionReceive = false): string {
  const label = resolveActionLabel(tx, t, hasCompanionReceive)
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
