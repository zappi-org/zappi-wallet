import type {
  MockPendingToken,
  MockTimelineEntry,
  TokenDetailData,
  TokenTabMockData,
  TokenViewState,
} from './types'

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
  timelineGroups: [],
}

const ACTIVE: TokenTabMockData = {
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

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/**
 * Absolute Korean-style date used by TokenDetailScreen.
 * Produces a two-line string like "26년 5월 1일 월요일\n16:30 {{suffix}}".
 * Suffix comes from i18n (e.g. "생성됨", "에 등록함").
 */
export function formatDetailDateLine(
  t: (key: string, opts?: Record<string, unknown>) => string,
  timestamp: number,
  suffixKey: string,
): string {
  const d = new Date(timestamp)
  const yy = d.getFullYear() % 100
  const month = d.getMonth() + 1
  const day = d.getDate()
  const weekday = t(`token.detail.weekday.${WEEKDAY_KEYS[d.getDay()]}`)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return t(suffixKey, {
    year: yy,
    month,
    day,
    weekday,
    time: `${hh}:${mm}`,
  })
}

const MOCK_TOKEN_STRING =
  'cashuBo2FteCNodHRwczovL21pbnQubGVtb25maXp6Lm1pbnQvdjEvaW50LmV4YW1wbGVhdWNzYXR' +
  'hdIGiYWlIAIEJVRy0yMDI2YXCEpGFhAWFzeEA5YTQyNzlmNzBlMjZjNTVkZDc2MWYzZTczNWFiYTcw' +
  'ZjYwNjYwMjc0NGU0NjM0NmEyMDE5NmZjNTA5NTM3MzM4YWN4QDAxYWIyZjFhYzk5ZTJjNzNlMTZjMz' +
  'VhZjVjMTdjMDg4Y2YwYzQ5NWY5OGVjM2I4ZDU1NWEzN2NlNTg4OTVhYxBLRZxn8e/example/ecash'

export interface PendingDetailExtras {
  mintAlias?: string
  mintName?: string
  mintIconUrl?: string
  fiatUsd?: number
}

/** Convert pending view → detail shape (always 'pending', orange dot). */
export function pendingToDetail(
  token: MockPendingToken,
  extras: PendingDetailExtras = {},
): TokenDetailData {
  return {
    id: token.id,
    status: 'pending',
    amount: token.amount,
    memo: token.memo,
    createdAt: token.createdAt,
    reclaimFee: 2,
    mintAlias: extras.mintAlias ?? '—',
    mintName: extras.mintName,
    mintIconUrl: extras.mintIconUrl,
    mintUrl: token.mintUrl,
    fiatUsd: extras.fiatUsd,
    unit: 'sat',
    unread: true,
    tokenString: token.tokenString ?? MOCK_TOKEN_STRING,
  }
}

/** Convert timeline mock → detail shape — status matches entry.status. */
export function timelineToDetail(entry: MockTimelineEntry): TokenDetailData {
  const needsFee = entry.status === 'registered' || entry.status === 'reclaimed'
  return {
    id: entry.id,
    status: entry.status,
    amount: entry.amount,
    memo: entry.memo,
    createdAt: entry.at,
    statusAt: entry.at,
    fee: needsFee ? 3 : undefined,
    mintAlias: '민트 3',
    mintName: 'Lemonfizz Mint',
    unit: 'sat',
    tokenString: MOCK_TOKEN_STRING,
  }
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
