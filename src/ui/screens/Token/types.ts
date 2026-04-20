export type TokenViewState = 'empty' | 'active' | 'first-create'

export interface MockPendingToken {
  id: string
  createdAt: number
  amount: number
  memo: string
  counterparty: string
  fiatUsd?: number
}

export type MockTimelineStatus = 'registered' | 'consumed' | 'reclaimed'

export interface MockTimelineEntry {
  id: string
  at: number
  amount: number
  status: MockTimelineStatus
  memo: string
  counterparty: string
}

export type MockTimelineGroupLabel = 'today' | 'yesterday'

export interface MockTimelineGroup {
  label: MockTimelineGroupLabel
  entries: MockTimelineEntry[]
}

export interface TokenTabMockData {
  pendingTokens: MockPendingToken[]
  timelineGroups: MockTimelineGroup[]
}

/** Token detail view status — pending includes created-but-unclaimed ecash tokens. */
export type TokenDetailStatus = 'pending' | 'registered' | 'consumed' | 'reclaimed'

/** Data shape consumed by TokenDetailScreen. Independent of mock/production source. */
export interface TokenDetailData {
  id: string
  status: TokenDetailStatus
  amount: number
  memo?: string
  /** Creation timestamp (ms) — always present */
  createdAt: number
  /** Status-change timestamp (ms). For 'registered'/'reclaimed'. Falls back to createdAt if absent. */
  statusAt?: number
  /** Fee in sats — shown under amount for 'registered'/'reclaimed'. */
  fee?: number
  /** Fee in sats required to reclaim — shown inside the pending reclaim CTA. */
  reclaimFee?: number
  /** Mint info for the contextual mint row. */
  mintAlias: string
  mintName?: string
  mintIconUrl?: string
  /** Mint URL that issued the token — used for the raw sheet. */
  mintUrl?: string
  /** Cashu token string — used for QR/copy/share/raw sheet. */
  tokenString?: string
  /** Fiat (USD) snapshot — optional, shown inline after amount. */
  fiatUsd?: number
  /** Base unit (e.g. 'sat') — shown in raw sheet. */
  unit?: string
  /** Show orange "unread" dot on the pending title. */
  unread?: boolean
}
