import type { TokenTabMockData, TokenViewState } from './types'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

function minutesAgo(n: number): number {
  return Date.now() - n * MINUTE_MS
}

function yesterdayAt(hour: number): number {
  const d = new Date(Date.now() - DAY_MS)
  d.setHours(hour, 0, 0, 0)
  return d.getTime()
}

const EMPTY: TokenTabMockData = {
  pendingTokens: [],
  timelineGroups: [],
}

const ACTIVE: TokenTabMockData = {
  pendingTokens: [
    {
      id: 'p1',
      createdAt: minutesAgo(5),
      amount: 1000,
      memo: '커피값',
      counterparty: '레모닝',
    },
    {
      id: 'p2',
      createdAt: minutesAgo(15),
      amount: 10000,
      memo: '밥값',
      counterparty: '레모닝',
    },
    {
      id: 'p3',
      createdAt: minutesAgo(42),
      amount: 2500,
      memo: '택시비',
      counterparty: '레모닝',
    },
  ],
  timelineGroups: [
    {
      label: 'today',
      entries: [
        {
          id: 't1',
          at: minutesAgo(0),
          amount: 1000,
          status: 'registered',
          memo: '커피값',
          counterparty: '레모닝',
        },
        {
          id: 't2',
          at: minutesAgo(15),
          amount: 3000,
          status: 'created',
          memo: '밥값',
          counterparty: '레몬피즈',
        },
        {
          id: 't3',
          at: minutesAgo(30),
          amount: 10000,
          status: 'reclaimed',
          memo: '커피값',
          counterparty: '레몬피즈',
        },
      ],
    },
    {
      label: 'yesterday',
      entries: [
        {
          id: 't4',
          at: yesterdayAt(18),
          amount: 1000,
          status: 'registered',
          memo: '커피값',
          counterparty: '레몬피즈',
        },
        {
          id: 't5',
          at: yesterdayAt(15),
          amount: 10000,
          status: 'reclaimed',
          memo: '커피값',
          counterparty: '레몬피즈',
        },
        {
          id: 't6',
          at: yesterdayAt(12),
          amount: 10000,
          status: 'consumed',
          memo: '커피값',
          counterparty: '레몬피즈',
        },
      ],
    },
  ],
}

const FIRST_CREATE: TokenTabMockData = {
  pendingTokens: [
    {
      id: 'p1',
      createdAt: minutesAgo(5),
      amount: 1000,
      memo: '커피값',
      counterparty: '레모닝',
    },
  ],
  timelineGroups: [],
}

export function pickMockData(state: TokenViewState): TokenTabMockData {
  switch (state) {
    case 'empty':
      return EMPTY
    case 'active':
      return ACTIVE
    case 'first-create':
      return FIRST_CREATE
  }
}

export function pendingTotalAmount(data: TokenTabMockData): number {
  return data.pendingTokens.reduce((sum, p) => sum + p.amount, 0)
}

export function formatRelativeTime(
  t: (key: string, opts?: Record<string, unknown>) => string,
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
