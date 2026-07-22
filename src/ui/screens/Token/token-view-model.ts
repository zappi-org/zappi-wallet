import type { TranslationKey } from '@/i18n'
import type { TFunction } from 'i18next'
import type {
  PendingTokenView,
  TokenDetailData,
  TokenFiatDisplay,
} from './types'

const MINUTE_MS = 60 * 1000

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/**
 * Absolute Korean-style date used by TokenDetailScreen.
 * Produces a two-line string like "26년 5월 1일 월요일\n16:30 {{suffix}}".
 * Suffix comes from i18n (e.g. "생성됨", "에 등록함").
 */
export function formatDetailDateLine(
  t: TFunction,
  timestamp: number,
  suffixKey: TranslationKey,
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
  fiat?: TokenFiatDisplay
}

/** Convert pending view → detail shape (always 'pending', orange dot). */
export function pendingToDetail(
  token: PendingTokenView,
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
    fiat: extras.fiat,
    unit: 'sat',
    unread: true,
    tokenString: token.tokenString,
  }
}

export function formatRelativeTime(
  t: TFunction,
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
