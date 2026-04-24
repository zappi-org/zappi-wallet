import { describe, it, expect } from 'vitest'
import { groupTransactionsForTimeline } from '@/ui/hooks/use-transaction-history'
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

describe('groupTransactionsForTimeline', () => {
  // 2026-04-21 (Tuesday) 14:00 — our fixed "now"
  const NOW = new Date(2026, 3, 21, 14, 0, 0)
  const DAY_MS = 24 * 60 * 60 * 1000

  const todayStart = new Date(2026, 3, 21, 0, 0, 0).getTime()
  const yesterdayStart = todayStart - DAY_MS

  it('per-day bucket for daysSince < 15', () => {
    const txs = [
      makeTx('t0', todayStart + 60_000),            // daysSince=0
      makeTx('t1', yesterdayStart + 10_000),        // daysSince=1
      makeTx('t14', todayStart - 14 * DAY_MS + 100), // daysSince=14 (still per-day)
    ]

    const groups = groupTransactionsForTimeline(txs, NOW)

    expect(groups.map((g) => g.kind)).toEqual(['day', 'day', 'day'])
    expect(groups[0].daysSince).toBe(0)
    expect(groups[1].daysSince).toBe(1)
    expect(groups[2].daysSince).toBe(14)
  })

  it('partOfMonth bucket for 15 ≤ daysSince < 30', () => {
    // Apr 6 → day 6 → 'early'; daysSince = 15
    const apr6 = new Date(2026, 3, 6, 10, 0, 0).getTime()
    // Apr 2 → day 2 → 'early'; daysSince = 19
    const apr2 = new Date(2026, 3, 2, 10, 0, 0).getTime()
    const txs = [makeTx('a6', apr6), makeTx('a2', apr2)]

    const groups = groupTransactionsForTimeline(txs, NOW)

    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('partOfMonth')
    expect(groups[0].part).toBe('early')
    expect(groups[0].year).toBe(2026)
    expect(groups[0].month).toBe(4)
    expect(groups[0].entries.map((e) => e.id)).toEqual(['a6', 'a2'])
  })

  it('month bucket for daysSince ≥ 30', () => {
    // March 20 → daysSince = 32
    const mar20 = new Date(2026, 2, 20, 10, 0, 0).getTime()
    const mar5 = new Date(2026, 2, 5, 10, 0, 0).getTime()
    const txs = [makeTx('m20', mar20), makeTx('m5', mar5)]

    const groups = groupTransactionsForTimeline(txs, NOW)

    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('month')
    expect(groups[0].year).toBe(2026)
    expect(groups[0].month).toBe(3)
    expect(groups[0].entries.map((e) => e.id)).toEqual(['m20', 'm5'])
  })

  it('partOfMonth part split: early (≤10) / mid (11-20) / late (≥21)', () => {
    // All within 15-29 day window from NOW=2026-04-21
    // NOW - 15 = 2026-04-06 (early), NOW - 20 = 2026-04-01 (early), NOW - 25 = 2026-03-27 (late),
    const apr6 = new Date(2026, 3, 6, 10, 0, 0).getTime()  // daysSince=15, early
    const mar31 = new Date(2026, 2, 31, 10, 0, 0).getTime() // daysSince=21, late
    const mar22 = new Date(2026, 2, 22, 10, 0, 0).getTime() // wait daysSince=30 → month, not partOfMonth

    // Let's use daysSince 25 (Mar 27) for late, and daysSince 16 (Apr 5) for early.
    const apr5 = new Date(2026, 3, 5, 10, 0, 0).getTime()   // daysSince=16, early
    const mar27 = new Date(2026, 2, 27, 10, 0, 0).getTime() // daysSince=25, late
    void mar31
    void mar22

    const txs = [makeTx('a6', apr6), makeTx('a5', apr5), makeTx('m27', mar27)]
    const groups = groupTransactionsForTimeline(txs, NOW)

    const kinds = new Set(groups.map((g) => g.kind))
    expect(kinds.has('partOfMonth')).toBe(true)

    // apr6 + apr5 merge into Apr/early; mar27 stands alone in Mar/late
    const aprEarly = groups.find((g) => g.year === 2026 && g.month === 4 && g.part === 'early')
    expect(aprEarly?.entries.map((e) => e.id)).toEqual(['a6', 'a5'])

    const marLate = groups.find((g) => g.year === 2026 && g.month === 3 && g.part === 'late')
    expect(marLate?.entries.map((e) => e.id)).toEqual(['m27'])
  })

  it('sorts entries within a day group by createdAt descending', () => {
    const txs = [
      makeTx('t-old', todayStart + 60_000),
      makeTx('t-new', todayStart + 120_000),
      makeTx('t-mid', todayStart + 90_000),
    ]
    const groups = groupTransactionsForTimeline(txs, NOW)
    expect(groups[0].kind).toBe('day')
    expect(groups[0].entries.map((e) => e.id)).toEqual(['t-new', 't-mid', 't-old'])
  })

  it('sorts groups by most-recent entry descending', () => {
    // Today group (most recent) + yesterday group + march group
    const mar20 = new Date(2026, 2, 20, 10, 0, 0).getTime()
    const txs = [
      makeTx('mar', mar20),
      makeTx('today', todayStart + 60_000),
      makeTx('yesterday', yesterdayStart + 60_000),
    ]
    const groups = groupTransactionsForTimeline(txs, NOW)
    expect(groups.map((g) => g.entries[0].id)).toEqual(['today', 'yesterday', 'mar'])
  })

  it('folds future-dated entries into today', () => {
    const future = todayStart + 48 * 60 * 60 * 1000 // 2 days ahead
    const txs = [makeTx('future', future)]
    const groups = groupTransactionsForTimeline(txs, NOW)
    expect(groups[0].kind).toBe('day')
    expect(groups[0].daysSince).toBe(0)
  })

  it('handles empty input', () => {
    expect(groupTransactionsForTimeline([], NOW)).toEqual([])
  })

  it('day group key includes year-month-day', () => {
    const txs = [makeTx('t', todayStart + 60_000)]
    const groups = groupTransactionsForTimeline(txs, NOW)
    expect(groups[0].key).toBe('day-2026-4-21')
    expect(groups[0].year).toBe(2026)
    expect(groups[0].month).toBe(4)
    expect(groups[0].day).toBe(21)
  })
})
