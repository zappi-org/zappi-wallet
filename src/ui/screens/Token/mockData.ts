import { getTxMeta } from '@/core/domain/transaction'
import { toNumber } from '@/core/domain/amount'
import type { Transaction } from '@/core/domain/transaction'
import type {
  MockPendingToken,
  TokenDetailData,
  TokenDetailStatus,
} from './types'

const MINUTE_MS = 60 * 1000

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/**
 * Absolute Korean-style date used by TokenDetailScreen.
 * Produces a two-line string like "26년 5월 1일 월요일\n16:30 {{suffix}}".
 * Suffix comes from i18n (e.g. "생성됨", "에 등록함").
 */
export function formatDetailDateLine(
  t: (key: string, opts?: Record<string, unknown>) => string,
  timestamp: number,
  suffixKey: string,
): string {
  const d = new Date(timestamp)
  const yy = d.getFullYear() % 100
  const month = d.getMonth() + 1
  const day = d.getDate()
  const weekday = t(`token.detail.weekday.${WEEKDAY_KEYS[d.getDay()]}`)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return t(suffixKey, {
    year: yy,
    month,
    day,
    weekday,
    time: `${hh}:${mm}`,
  })
}

export interface PendingDetailExtras {
  mintAlias?: string
  mintName?: string
  mintIconUrl?: string
  fiatUsd?: number
}

/** Convert pending view → detail shape (always 'pending', orange dot). */
export function pendingToDetail(
  token: MockPendingToken,
  extras: PendingDetailExtras = {},
): TokenDetailData {
  return {
    id: token.id,
    status: 'pending',
    amount: token.amount,
    memo: token.memo,
    createdAt: token.createdAt,
    reclaimFee: token.reclaimFee ?? 2,
    mintAlias: extras.mintAlias ?? '—',
    mintName: extras.mintName,
    mintIconUrl: extras.mintIconUrl,
    mintUrl: token.mintUrl,
    fiatUsd: extras.fiatUsd,
    unit: 'sat',
    unread: true,
    tokenString: token.tokenString,
  }
}

/**
 * True if a Transaction belongs in the Token-tab Timeline (ecash token lifecycle).
 * Includes:
 * - Received ecash tokens I redeemed (direction='receive', outcome='claimed')
 * - Sent ecash tokens recipient claimed (direction='send', outcome='claimed')
 * - Sent ecash tokens I reclaimed (direction='send', outcome='reclaimed')
 * Excludes:
 * - Pending sends (rendered via usePendingItems)
 * - Swaps
 * - Auto-generated reclaim-receive sub-tx (observer creates a -reclaim tx with
 *   metadata.reclaimedFrom for general history visibility; the reclaim is
 *   already shown via the original send tx with outcome='reclaimed', so the
 *   sub-tx is a duplicate here and lacks the original tokenString).
 */
export function isTokenTimelineTx(tx: Transaction): boolean {
  if (tx.protocol !== 'cashu-token') return false
  if (tx.intent === 'swap') return false
  if (tx.intent === 'request-fulfill') return false
  if (tx.status !== 'settled') return false
  if (tx.metadata?.reclaimedFrom) return false
  return tx.outcome === 'claimed' || tx.outcome === 'reclaimed'
}

/** Derive TokenDetailStatus from a Transaction. Returns null if not a timeline item. */
export function transactionToDetailStatus(tx: Transaction): TokenDetailStatus | null {
  if (!isTokenTimelineTx(tx)) return null
  if (tx.outcome === 'reclaimed') return 'reclaimed'
  // I sent a token, recipient claimed/used it → '사용됨'
  if (tx.direction === 'send' && tx.outcome === 'claimed') return 'consumed'
  // I received a token and registered into my wallet → '등록함'
  if (tx.direction === 'receive' && tx.outcome === 'claimed') return 'registered'
  return null
}

/** Convert a settled ecash Transaction → detail shape for TokenDetailScreen. */
export function transactionToDetail(
  tx: Transaction,
  extras: PendingDetailExtras = {},
): TokenDetailData | null {
  const status = transactionToDetailStatus(tx)
  if (!status) return null

  const meta = getTxMeta(tx)
  const feeAmount = tx.fee
    ? toNumber(tx.fee.effective ?? tx.fee.quoted)
    : meta.fee

  return {
    id: tx.id,
    status,
    amount: toNumber(tx.amount),
    memo: tx.memo,
    createdAt: tx.createdAt,
    statusAt: tx.completedAt ?? tx.createdAt,
    fee: feeAmount,
    mintAlias: extras.mintAlias ?? '—',
    mintName: extras.mintName,
    mintIconUrl: extras.mintIconUrl,
    mintUrl: tx.accountId,
    tokenString: meta.token,
    fiatUsd: extras.fiatUsd,
    unit: 'sat',
  }
}

export function formatRelativeTime(
  t: (key: string, opts?: Record<string, unknown>) => string,
  timestamp: number,
): string {
  const diffMs = Date.now() - timestamp
  const minutes = Math.max(0, Math.floor(diffMs / MINUTE_MS))
  if (minutes < 1) return t('token.time.justNow')
  if (minutes < 60) return t('token.time.minutesAgo', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('token.time.hoursAgo', { count: hours })
  const days = Math.floor(hours / 24)
  if (days === 1) return t('token.time.yesterday')
  return t('token.time.daysAgo', { count: days })
}
