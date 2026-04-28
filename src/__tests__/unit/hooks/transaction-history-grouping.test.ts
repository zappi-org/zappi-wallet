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
  const DAY_MS = 24 * 60 * 60 * 1000

  const todayStart = new Date(2026, 3, 21, 0, 0, 0).getTime()
  const yesterdayStart = todayStart - DAY_MS

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

  it('day-before-yesterday and older same-month / same-year → monthThisYear, merged', () => {
    const dby = todayStart - 2 * DAY_MS // 2026-04-19
    const apr10 = new Date(2026, 3, 10, 10, 0, 0).getTime()
    const txs = [makeTx('a', dby), makeTx('b', apr10)]
    const groups = groupTransactionsForTimeline(txs, NOW)
    expect(groups).toHaveLength(1)
    expect(groups[0].kind).toBe('monthThisYear')
    expect(groups[0].year).toBe(2026)
    expect(groups[0].month).toBe(4)
    expect(groups[0].entries.map((e) => e.id)).toEqual(['a', 'b'])
  })

  it('different month same year → separate monthThisYear groups', () => {
    const apr10 = new Date(2026, 3, 10, 10, 0, 0).getTime()
    const mar5 = new Date(2026, 2, 5, 10, 0, 0).getTime()
    const groups = groupTransactionsForTimeline([makeTx('a', apr10), makeTx('m', mar5)], NOW)
    expect(groups.map((g) => `${g.year}-${g.month}-${g.kind}`)).toEqual([
      '2026-4-monthThisYear',
      '2026-3-monthThisYear',
    ])
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
    const future = todayStart + 48 * DAY_MS
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

  it('group keys: today/yesterday include Y-M-D, monthThisYear includes Y-M, monthPastYear includes Y-M', () => {
    const txs = [
      makeTx('t', todayStart + 60_000),
      makeTx('y', yesterdayStart + 60_000),
      makeTx('m', new Date(2026, 2, 10, 10, 0, 0).getTime()),
      makeTx('p', new Date(2025, 11, 18, 10, 0, 0).getTime()),
    ]
    const groups = groupTransactionsForTimeline(txs, NOW)
    const byKind = Object.fromEntries(groups.map((g) => [g.kind, g.key]))
    expect(byKind.today).toBe('today-2026-4-21')
    expect(byKind.yesterday).toBe('yesterday-2026-4-20')
    expect(byKind.monthThisYear).toBe('month-2026-3')
    expect(byKind.monthPastYear).toBe('pastMonth-2025-12')
  })
})
