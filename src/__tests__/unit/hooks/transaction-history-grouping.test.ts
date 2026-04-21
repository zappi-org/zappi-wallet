import { describe, it, expect } from 'vitest'
import { groupTransactionsByBucket } from '@/ui/hooks/use-transaction-history'
import { sat } from '@/core/domain/amount'
import type { Transaction } from '@/core/domain/transaction'

function makeTx(id: string, createdAt: number, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id,
    direction: 'send',
    method: 'cashu:ecash',
    protocol: 'cashu-token',
    amount: sat(1000),
    accountId: 'https://mint.test',
    status: 'settled',
    createdAt,
    ...overrides,
  }
}

describe('groupTransactionsByBucket', () => {
  // 2026-04-21 (Tuesday) 14:00 — our fixed "now"
  const NOW = new Date(2026, 3, 21, 14, 0, 0)
  const DAY_MS = 24 * 60 * 60 * 1000

  const todayStart = new Date(2026, 3, 21, 0, 0, 0).getTime()
  const yesterdayStart = todayStart - DAY_MS
  const monthStart = new Date(2026, 3, 1, 0, 0, 0).getTime()

  it('classifies today / yesterday / thisMonth / older correctly', () => {
    const txs = [
      makeTx('t1', todayStart + 60_000),           // today
      makeTx('t2', yesterdayStart + 10_000),       // yesterday
      makeTx('t3', monthStart + DAY_MS * 5),       // thisMonth (Apr 6)
      makeTx('t4', monthStart - DAY_MS * 3),       // older
    ]

    const groups = groupTransactionsByBucket(txs, NOW)

    expect(groups.map((g) => g.label)).toEqual(['today', 'yesterday', 'thisMonth', 'older'])
    expect(groups[0].entries.map((e) => e.id)).toEqual(['t1'])
    expect(groups[1].entries.map((e) => e.id)).toEqual(['t2'])
    expect(groups[2].entries.map((e) => e.id)).toEqual(['t3'])
    expect(groups[3].entries.map((e) => e.id)).toEqual(['t4'])
  })

  it('sorts within each bucket by createdAt descending', () => {
    const txs = [
      makeTx('t-old', todayStart + 60_000),
      makeTx('t-new', todayStart + 120_000),
      makeTx('t-mid', todayStart + 90_000),
    ]

    const groups = groupTransactionsByBucket(txs, NOW)

    expect(groups[0].label).toBe('today')
    expect(groups[0].entries.map((e) => e.id)).toEqual(['t-new', 't-mid', 't-old'])
  })

  it('omits empty buckets from the returned array', () => {
    const txs = [makeTx('t1', todayStart + 60_000)]

    const groups = groupTransactionsByBucket(txs, NOW)

    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('today')
  })

  it('treats exact todayStart boundary as today', () => {
    const txs = [makeTx('t-edge', todayStart)]
    const groups = groupTransactionsByBucket(txs, NOW)
    expect(groups[0].label).toBe('today')
  })

  it('treats exact yesterdayStart boundary as yesterday', () => {
    const txs = [makeTx('t-edge', yesterdayStart)]
    const groups = groupTransactionsByBucket(txs, NOW)
    expect(groups[0].label).toBe('yesterday')
  })

  it('treats the last ms before monthStart as older', () => {
    const txs = [makeTx('t-edge', monthStart - 1)]
    const groups = groupTransactionsByBucket(txs, NOW)
    expect(groups[0].label).toBe('older')
  })

  it('handles empty input', () => {
    expect(groupTransactionsByBucket([], NOW)).toEqual([])
  })

  it('bucketing is stable for first-of-month now', () => {
    // If now is April 1st, yesterdayStart < monthStart → yesterday belongs to `older` by current rules
    // Goal: verify the current bucket boundaries remain consistent.
    const aprilFirst = new Date(2026, 3, 1, 10, 0, 0)
    const aprilFirstStart = new Date(2026, 3, 1, 0, 0, 0).getTime()
    const march31Start = aprilFirstStart - DAY_MS

    const txs = [
      makeTx('t-today', aprilFirstStart + 60_000),
      makeTx('t-yesterday', march31Start + 60_000),
    ]

    const groups = groupTransactionsByBucket(txs, aprilFirst)
    const labels = groups.map((g) => g.label)
    expect(labels).toContain('today')
    expect(labels).toContain('yesterday')
  })
})
