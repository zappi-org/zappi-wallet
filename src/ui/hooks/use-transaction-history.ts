/**
 * useTransactionHistory — 거래내역을 날짜 버킷으로 그룹핑해 반환.
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

export type TimelineBucket = 'today' | 'yesterday' | 'thisMonth' | 'older'

export interface TimelineGroup {
  label: TimelineBucket
  entries: Transaction[]
}

export interface UseTransactionHistoryOptions {
  limit?: number
  filter?: (tx: Transaction) => boolean
}

/**
 * Pure date-bucket grouping helper.
 * Buckets are computed relative to `now` (default: current time):
 * - today: same calendar day as now
 * - yesterday: previous calendar day
 * - thisMonth: same calendar month but not today/yesterday
 * - older: everything else
 *
 * Entries inside each group sorted by `createdAt` descending.
 * Empty groups are omitted from the returned array.
 */
export function groupTransactionsByBucket(
  transactions: readonly Transaction[],
  now: Date = new Date(),
): TimelineGroup[] {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 24 * 60 * 60 * 1000
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

  const buckets: Record<TimelineBucket, Transaction[]> = {
    today: [],
    yesterday: [],
    thisMonth: [],
    older: [],
  }

  for (const tx of transactions) {
    const ts = tx.createdAt
    if (ts >= todayStart) buckets.today.push(tx)
    else if (ts >= yesterdayStart) buckets.yesterday.push(tx)
    else if (ts >= monthStart) buckets.thisMonth.push(tx)
    else buckets.older.push(tx)
  }

  const sortDesc = (list: Transaction[]) =>
    list.sort((a, b) => b.createdAt - a.createdAt)

  const order: TimelineBucket[] = ['today', 'yesterday', 'thisMonth', 'older']
  return order
    .map((label): TimelineGroup => ({ label, entries: sortDesc(buckets[label]) }))
    .filter((g) => g.entries.length > 0)
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
    return groupTransactionsByBucket(filtered)
  }, [transactions, filter])

  return { groups, isLoading, error, refresh }
}
