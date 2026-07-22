import type { TFunction } from 'i18next'

const MINUTE_MS = 60 * 1000

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
