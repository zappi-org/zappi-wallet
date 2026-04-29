/**
 * useTransactionHistory — 거래내역을 시간 의미 그룹(오늘/어제/이번달 일자/이번해월/작년이전월)으로 분할해 반환.
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

export type TimelineKind =
  | 'today'
  | 'yesterday'
  | 'dayThisMonth'
  | 'monthThisYear'
  | 'monthPastYear'

export interface TimelineGroup {
  key: string
  kind: TimelineKind
  year: number
  /** 1-12 */
  month: number
  /** 1-31. set only when kind === 'today' | 'yesterday' | 'dayThisMonth' */
  day?: number
  /** most recent entry timestamp — used for group sort */
  refDate: number
  entries: Transaction[]
}

export interface UseTransactionHistoryOptions {
  limit?: number
  filter?: (tx: Transaction) => boolean
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function startOfPreviousLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1).getTime()
}

/**
 * Pure timeline grouping helper, computed relative to `now`:
 * - same day (incl. future-dated, folded in) → `today`, key `today-Y-M-D`
 * - previous day → `yesterday`, key `yesterday-Y-M-D`
 * - older within same calendar month/year → `dayThisMonth`, key `day-Y-M-D` (per-day groups)
 * - older within same calendar year → `monthThisYear`, key `month-Y-M`
 * - prior calendar year(s) → `monthPastYear`, key `pastMonth-Y-M`
 *
 * Entries inside each group are sorted by `createdAt` descending.
 * Groups are sorted by most-recent entry descending.
 * Empty groups are omitted.
 */
export function groupTransactionsForTimeline(
  transactions: readonly Transaction[],
  now: Date = new Date(),
): TimelineGroup[] {
  const todayStart = startOfLocalDay(now)
  const yesterdayStart = startOfPreviousLocalDay(now)
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1
  const map = new Map<string, TimelineGroup>()

  for (const tx of transactions) {
    const d = new Date(tx.createdAt)
    const txDayStart = startOfLocalDay(d)
    const year = d.getFullYear()
    const month = d.getMonth() + 1
    const day = d.getDate()

    let key: string
    let kind: TimelineKind
    let groupYear = year
    let groupMonth = month
    let groupDay: number | undefined

    if (txDayStart >= todayStart) {
      // same day or future-dated → fold into today
      kind = 'today'
      groupYear = now.getFullYear()
      groupMonth = now.getMonth() + 1
      groupDay = now.getDate()
      key = `today-${groupYear}-${groupMonth}-${groupDay}`
    } else if (txDayStart === yesterdayStart) {
      kind = 'yesterday'
      groupDay = day
      key = `yesterday-${year}-${month}-${day}`
    } else if (year === currentYear && month === currentMonth) {
      kind = 'dayThisMonth'
      groupDay = day
      key = `day-${year}-${month}-${day}`
    } else if (year === currentYear) {
      kind = 'monthThisYear'
      key = `month-${year}-${month}`
    } else {
      kind = 'monthPastYear'
      key = `pastMonth-${year}-${month}`
    }

    const existing = map.get(key)
    if (!existing) {
      map.set(key, {
        key,
        kind,
        year: groupYear,
        month: groupMonth,
        day: groupDay,
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
