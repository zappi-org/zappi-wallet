export type TokenViewState = 'empty' | 'active' | 'first-create'

export interface MockPendingToken {
  id: string
  createdAt: number
  amount: number
  memo: string
  counterparty: string
}

export type MockTimelineStatus = 'created' | 'registered' | 'consumed' | 'reclaimed'

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
