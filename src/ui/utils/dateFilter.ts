import type { DateRange } from 'react-day-picker'

// ─── Types ───

type Preset = '1w' | '1m' | '3m' | 'all'

export interface DateFilterValue {
  preset: Preset | null
  range: DateRange | undefined
}

// ─── Constants ───

export const DAY_MS = 86_400_000

// ─── Utilities ───

/** Format date as M.DD (Toss style) */
export function formatMD(d: Date): string {
  return `${d.getMonth() + 1}.${d.getDate()}`
}

/** Convert DateFilterValue to epoch cutoff range, or null for 'all' */
export function computeDateCutoff(dateFilter: DateFilterValue): { from: number; to: number } | null {
  if (dateFilter.preset) {
    if (dateFilter.preset === 'all') return null
    const now = Date.now()
    return {
      from: dateFilter.preset === '1w' ? now - 7 * DAY_MS
        : dateFilter.preset === '1m' ? now - 30 * DAY_MS
        : now - 90 * DAY_MS,
      to: now,
    }
  }
  if (dateFilter.range?.from) {
    return {
      from: dateFilter.range.from.getTime(),
      to: dateFilter.range.to ? dateFilter.range.to.getTime() + DAY_MS - 1 : Date.now(),
    }
  }
  return null
}

/** Get display label for current date filter value */
export function getDateFilterLabel(dateFilter: DateFilterValue, t: (key: string) => string): string {
  if (dateFilter.preset) {
    if (dateFilter.preset === 'all') return t('history.periodAll')
    if (dateFilter.preset === '1w') return t('history.period1w')
    if (dateFilter.preset === '1m') return t('history.period1m')
    return t('history.period3m')
  }
  if (dateFilter.range?.from && dateFilter.range?.to) {
    return `${formatMD(dateFilter.range.from)} - ${formatMD(dateFilter.range.to)}`
  }
  return t('history.periodAll')
}

/** Check if a date filter is actively filtering (not 'all') */
export function isDateFilterActive(dateFilter: DateFilterValue): boolean {
  return (dateFilter.preset !== 'all' && dateFilter.preset !== null) || dateFilter.range?.from != null
}

/** Format date label with today/yesterday detection, M.DD fallback */
export function formatDateGroupLabel(timestamp: number, t: (key: string, opts?: Record<string, string>) => string): string {
  const date = new Date(timestamp)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)

  if (date.toDateString() === now.toDateString()) {
    return t('history.today', { defaultValue: 'Today' })
  }
  if (date.toDateString() === yesterday.toDateString()) {
    return t('history.yesterday', { defaultValue: 'Yesterday' })
  }
  return formatMD(date)
}
