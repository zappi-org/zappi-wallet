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
  // 2026-04-21 (Tuesday) 14:00 — fixed "now"
  const NOW = new Date(2026, 3, 21, 14, 0, 0)

  const todayStart = new Date(2026, 3, 21, 0, 0, 0).getTime()
  const yesterdayStart = new Date(2026, 3, 20, 0, 0, 0).getTime()

  it('same-day → today group', () => {
    const txs = [makeTx('t', todayStart + 60_000)]
    const groups = groupTransactionsForTimeline(txs, NOW)
    expect(groups[0].kind).toBe('today')
    expect(groups[0].day).toBe(21)
    expect(groups[0].year).toBe(2026)
    expect(groups[0].month).toBe(4)
  })

  it('-1 day → yesterday group', () => {
    const txs = [makeTx('y', yesterdayStart + 60_000)]
    const groups = groupTransactionsForTimeline(txs, NOW)
    expect(groups[0].kind).toBe('yesterday')
    expect(groups[0].day).toBe(20)
  })

  it('day-before-yesterday and older same-month → separate dayThisMonth groups', () => {
    const dby = new Date(2026, 3, 19, 0, 0, 0).getTime()
    const apr10 = new Date(2026, 3, 10, 10, 0, 0).getTime()
    const txs = [makeTx('a', dby), makeTx('b', apr10)]
    const groups = groupTransactionsForTimeline(txs, NOW)
    expect(groups).toHaveLength(2)
    expect(groups.every((g) => g.kind === 'dayThisMonth')).toBe(true)
    expect(groups.map((g) => `${g.year}-${g.month}-${g.day}`)).toEqual([
      '2026-4-19',
      '2026-4-10',
    ])
    expect(groups.map((g) => g.entries[0].id)).toEqual(['a', 'b'])
  })

  it('current-month entries split per day; prior-month entries merge into monthThisYear', () => {
    const apr19 = new Date(2026, 3, 19, 0, 0, 0).getTime()
    const apr10 = new Date(2026, 3, 10, 10, 0, 0).getTime()
    const mar5 = new Date(2026, 2, 5, 10, 0, 0).getTime()
    const mar20 = new Date(2026, 2, 20, 10, 0, 0).getTime()
    const groups = groupTransactionsForTimeline(
      [makeTx('a', apr19), makeTx('b', apr10), makeTx('m1', mar5), makeTx('m2', mar20)],
      NOW,
    )
    expect(groups.map((g) => `${g.kind}:${g.year}-${g.month}${g.day ? `-${g.day}` : ''}`)).toEqual([
      'dayThisMonth:2026-4-19',
      'dayThisMonth:2026-4-10',
      'monthThisYear:2026-3',
    ])
    const march = groups.find((g) => g.kind === 'monthThisYear')!
    expect(march.entries.map((e) => e.id)).toEqual(['m2', 'm1'])
  })

  it('prior calendar year → monthPastYear', () => {
    const dec2025 = new Date(2025, 11, 18, 10, 0, 0).getTime()
    const groups = groupTransactionsForTimeline([makeTx('p', dec2025)], NOW)
    expect(groups[0].kind).toBe('monthPastYear')
    expect(groups[0].year).toBe(2025)
    expect(groups[0].month).toBe(12)
    expect(groups[0].key).toBe('pastMonth-2025-12')
  })

  it('midnight boundary: tx at 23:59:59 of previous day → yesterday', () => {
    const yEnd = todayStart - 1 // 2026-04-20 23:59:59.999
    const groups = groupTransactionsForTimeline([makeTx('y', yEnd)], NOW)
    expect(groups[0].kind).toBe('yesterday')
  })

  it('previous-day boundary uses local calendar day, not a fixed 24h offset', () => {
    // In DST zones such as America/New_York, 2026-03-08 is a 23-hour day.
    // The grouping must still classify local Mar 8 as "yesterday" on Mar 9.
    const mar9 = new Date(2026, 2, 9, 10, 0, 0)
    const mar8Noon = new Date(2026, 2, 8, 12, 0, 0).getTime()
    const groups = groupTransactionsForTimeline([makeTx('dst-yesterday', mar8Noon)], mar9)
    expect(groups[0].kind).toBe('yesterday')
    expect(groups[0].year).toBe(2026)
    expect(groups[0].month).toBe(3)
    expect(groups[0].day).toBe(8)
  })

  it('month boundary: now=May 1 00:00, tx=Apr 30 12:00 → monthThisYear (4월), not today', () => {
    const may1 = new Date(2026, 4, 1, 0, 0, 0)
    const apr30 = new Date(2026, 3, 30, 12, 0, 0).getTime()
    const groups = groupTransactionsForTimeline([makeTx('a', apr30)], may1)
    expect(groups[0].kind).toBe('yesterday')
    expect(groups[0].month).toBe(4)
    expect(groups[0].day).toBe(30)
  })

  it('month boundary further: now=May 2, tx=Apr 30 → monthThisYear, not yesterday', () => {
    const may2 = new Date(2026, 4, 2, 10, 0, 0)
    const apr30 = new Date(2026, 3, 30, 12, 0, 0).getTime()
    const groups = groupTransactionsForTimeline([makeTx('a', apr30)], may2)
    expect(groups[0].kind).toBe('monthThisYear')
    expect(groups[0].year).toBe(2026)
    expect(groups[0].month).toBe(4)
  })

  it('day-before-yesterday in same month → dayThisMonth, not monthThisYear', () => {
    const may3 = new Date(2026, 4, 3, 10, 0, 0)
    const may1 = new Date(2026, 4, 1, 12, 0, 0).getTime()
    const groups = groupTransactionsForTimeline([makeTx('a', may1)], may3)
    expect(groups[0].kind).toBe('dayThisMonth')
    expect(groups[0].year).toBe(2026)
    expect(groups[0].month).toBe(5)
    expect(groups[0].day).toBe(1)
    expect(groups[0].key).toBe('day-2026-5-1')
  })

  it('year boundary: now=Jan 2 2026, tx=Dec 31 2025 → monthPastYear, not yesterday', () => {
    const jan2 = new Date(2026, 0, 2, 10, 0, 0)
    const dec31 = new Date(2025, 11, 31, 23, 30, 0).getTime()
    const groups = groupTransactionsForTimeline([makeTx('d', dec31)], jan2)
    expect(groups[0].kind).toBe('monthPastYear')
    expect(groups[0].year).toBe(2025)
    expect(groups[0].month).toBe(12)
  })

  it('year boundary tight: now=Jan 1 2026, tx=Dec 31 2025 → yesterday', () => {
    const jan1 = new Date(2026, 0, 1, 10, 0, 0)
    const dec31 = new Date(2025, 11, 31, 12, 0, 0).getTime()
    const groups = groupTransactionsForTimeline([makeTx('d', dec31)], jan1)
    expect(groups[0].kind).toBe('yesterday')
  })

  it('future-dated tx folds into today', () => {
    const future = new Date(2026, 3, 23, 0, 0, 0).getTime()
    const groups = groupTransactionsForTimeline([makeTx('f', future)], NOW)
    expect(groups[0].kind).toBe('today')
  })

  it('sorts entries within a group by createdAt descending', () => {
    const txs = [
      makeTx('old', todayStart + 60_000),
      makeTx('new', todayStart + 120_000),
      makeTx('mid', todayStart + 90_000),
    ]
    const groups = groupTransactionsForTimeline(txs, NOW)
    expect(groups[0].entries.map((e) => e.id)).toEqual(['new', 'mid', 'old'])
  })

  it('sorts groups by most-recent entry descending: today → yesterday → thisYear → pastYear', () => {
    const txs = [
      makeTx('past', new Date(2025, 11, 5, 10, 0, 0).getTime()),
      makeTx('thisYear', new Date(2026, 2, 10, 10, 0, 0).getTime()),
      makeTx('yesterday', yesterdayStart + 60_000),
      makeTx('today', todayStart + 60_000),
    ]
    const groups = groupTransactionsForTimeline(txs, NOW)
    expect(groups.map((g) => g.entries[0].id)).toEqual([
      'today',
      'yesterday',
      'thisYear',
      'past',
    ])
  })

  it('handles empty input', () => {
    expect(groupTransactionsForTimeline([], NOW)).toEqual([])
  })

  it('group keys: today/yesterday/dayThisMonth include Y-M-D, monthThisYear/monthPastYear include Y-M', () => {
    const txs = [
      makeTx('t', todayStart + 60_000),
      makeTx('y', yesterdayStart + 60_000),
      makeTx('d', new Date(2026, 3, 19, 0, 0, 0).getTime()), // 2026-04-19, current month
      makeTx('m', new Date(2026, 2, 10, 10, 0, 0).getTime()),
      makeTx('p', new Date(2025, 11, 18, 10, 0, 0).getTime()),
    ]
    const groups = groupTransactionsForTimeline(txs, NOW)
    const byKind = Object.fromEntries(groups.map((g) => [g.kind, g.key]))
    expect(byKind.today).toBe('today-2026-4-21')
    expect(byKind.yesterday).toBe('yesterday-2026-4-20')
    expect(byKind.dayThisMonth).toBe('day-2026-4-19')
    expect(byKind.monthThisYear).toBe('month-2026-3')
    expect(byKind.monthPastYear).toBe('pastMonth-2025-12')
  })
})
