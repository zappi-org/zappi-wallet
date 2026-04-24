/**
 * useTransactionHistory — 거래내역을 날짜/기간 그룹으로 분할해 반환.
 *
 * `TransactionMgmtUseCase.list` 위에 얹어 UI 소비 형태(`TimelineGroup[]`)로 변환.
 * `txRefreshTrigger` 변경 시 자동 재조회.
 *
 * 필터는 순수 predicate — caller 가 protocol/direction/intent 등을 자유롭게 조합.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useServiceRegistry } from '@/ui/hooks/use-service-registry'
import { useAppStore } from '@/store'
import type { Transaction } from '@/core/domain/transaction'

export type TimelineKind = 'day' | 'partOfMonth' | 'month'
export type TimelinePart = 'early' | 'mid' | 'late'

export interface TimelineGroup {
  key: string
  kind: TimelineKind
  year: number
  /** 1-12 */
  month: number
  /** 1-31, set only when kind === 'day' */
  day?: number
  /** set only when kind === 'partOfMonth' */
  part?: TimelinePart
  /** 0=today, 1=yesterday, ≥2 N일전. set only when kind === 'day' */
  daysSince?: number
  /** most recent entry timestamp — used for weekday rendering + group sort */
  refDate: number
  entries: Transaction[]
}

export interface UseTransactionHistoryOptions {
  limit?: number
  filter?: (tx: Transaction) => boolean
}

const ONE_DAY = 24 * 60 * 60 * 1000
const DAY_BUCKET_CUTOFF = 15 // daysSince < 15 → per-day
const MONTH_BUCKET_CUTOFF = 30 // daysSince < 30 → partOfMonth; ≥30 → month

function partOfMonth(day: number): TimelinePart {
  if (day <= 10) return 'early'
  if (day <= 20) return 'mid'
  return 'late'
}

/**
 * Pure timeline grouping helper, computed relative to `now`:
 * - daysSince < 15 → per-day bucket keyed on (Y, M, D)
 * - 15 ≤ daysSince < 30 → partOfMonth bucket keyed on (Y, M, part) where
 *   part = 'early' (day 1–10) | 'mid' (11–20) | 'late' (21–31)
 * - daysSince ≥ 30 → per-month bucket keyed on (Y, M)
 *
 * Entries inside each group are sorted by `createdAt` descending.
 * Groups are sorted by most-recent entry descending.
 * Empty groups are omitted.
 */
export function groupTransactionsForTimeline(
  transactions: readonly Transaction[],
  now: Date = new Date(),
): TimelineGroup[] {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const map = new Map<string, TimelineGroup>()

  for (const tx of transactions) {
    const d = new Date(tx.createdAt)
    const txDayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const rawDaysSince = Math.round((todayStart - txDayStart) / ONE_DAY)
    // Future-dated transactions fold into today.
    const daysSince = Math.max(0, rawDaysSince)
    const year = d.getFullYear()
    const month = d.getMonth() + 1
    const day = d.getDate()

    let key: string
    let kind: TimelineKind
    let part: TimelinePart | undefined
    let groupDay: number | undefined
    let groupDaysSince: number | undefined

    if (daysSince < DAY_BUCKET_CUTOFF) {
      kind = 'day'
      key = `day-${year}-${month}-${day}`
      groupDay = day
      groupDaysSince = daysSince
    } else if (daysSince < MONTH_BUCKET_CUTOFF) {
      kind = 'partOfMonth'
      part = partOfMonth(day)
      key = `part-${year}-${month}-${part}`
    } else {
      kind = 'month'
      key = `month-${year}-${month}`
    }

    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        key,
        kind,
        year,
        month,
        day: groupDay,
        part,
        daysSince: groupDaysSince,
        refDate: tx.createdAt,
        entries: [tx],
      })
    } else {
      if (tx.createdAt > existing.refDate) existing.refDate = tx.createdAt
      existing.entries.push(tx)
    }
  }

  const groups = [...map.values()]
  for (const g of groups) {
    g.entries.sort((a, b) => b.createdAt - a.createdAt)
  }
  groups.sort((a, b) => b.refDate - a.refDate)
  return groups
}

export function useTransactionHistory(
  options: UseTransactionHistoryOptions = {},
): {
  groups: TimelineGroup[]
  isLoading: boolean
  error?: Error
  refresh: () => Promise<void>
} {
  const { limit, filter } = options
  const registry = useServiceRegistry()
  const txRefreshTrigger = useAppStore((s) => s.txRefreshTrigger)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | undefined>()

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(undefined)
    try {
      const list = await registry.transactionMgmt.list({ limit })
      setTransactions(list)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
      setTransactions([])
    } finally {
      setIsLoading(false)
    }
  }, [registry, limit])

  useEffect(() => {
    refresh()
    // txRefreshTrigger 변경 시 자동 재조회 — write 이벤트를 store 가 bump 함
  }, [refresh, txRefreshTrigger])

  const groups = useMemo(() => {
    const filtered = filter ? transactions.filter(filter) : transactions
    return groupTransactionsForTimeline(filtered)
  }, [transactions, filter])

  return { groups, isLoading, error, refresh }
}
