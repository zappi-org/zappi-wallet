import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const stableT = (key: string) => key

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/utils/format', async () => {
  const actual = await vi.importActual<typeof import('@/utils/format')>('@/utils/format')
  return {
    ...actual,
    useSatUnit: () => 'sats',
    useFormatFiat: () => () => null,
    useFormatSats: () => (v: number) => `${v} sats`,
  }
})

const storeState = {
  settings: { mints: ['https://mint.test'], mintAliases: {}, mintColors: {}, balanceHidden: false },
  updateSettings: vi.fn(),
}
function useAppStoreMock(selector: (s: typeof storeState) => unknown) {
  return selector(storeState)
}
useAppStoreMock.getState = () => storeState
vi.mock('@/store', () => ({
  useAppStore: useAppStoreMock,
}))

const pendingItemsState: { items: Array<Record<string, unknown>> } = { items: [] }
vi.mock('@/ui/hooks/usePendingItems', () => ({
  useAllPendingItems: () => ({ items: pendingItemsState.items, isLoading: false, refresh: () => Promise.resolve() }),
}))

vi.mock('@/ui/hooks', () => ({
  useWallet: () => ({ balance: { total: 0, byMint: {} }, isLoadingBalance: false }),
  useMintHealth: () => ({ checkAllMints: () => Promise.resolve(), getCachedStatus: () => undefined }),
  useMintMetadata: () => ({
    getDisplayName: (url: string) => url || '—',
    getOriginalName: (url: string) => url || '—',
    getIconUrl: () => undefined,
  }),
}))

vi.mock('@/ui/hooks/use-carousel-scroll', () => ({
  useCarouselScroll: () => ({
    carouselRef: { current: null },
    cardRefs: { current: [] },
    handleScroll: () => {},
    updateScales: () => {},
    scrollToIndex: () => {},
  }),
}))

vi.mock('@/ui/hooks/use-pull-to-refresh', () => ({
  usePullToRefresh: () => ({
    scrollContainerRef: { current: null },
    indicatorRef: { current: null },
    iconRef: { current: null },
    isRefreshing: false,
  }),
}))

import { HomeScreen } from '@/ui/screens/Home/HomeScreen'
import type { Transaction } from '@/core/domain/transaction'
import { sat } from '@/core/domain/amount'

function makePendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'req1',
    direction: 'receive',
    kind: 'request',
    amount: 1000,
    accountId: 'https://mint.test',
    createdAt: Date.now(),
    details: { quoteId: 'q1', invoice: 'lnbc1' },
    ...overrides,
  }
}

const renderScreen = (props: Partial<React.ComponentProps<typeof HomeScreen>> = {}) =>
  render(<HomeScreen onProfile={() => {}} transactions={[]} {...props} />)

beforeEach(() => {
  cleanup()
  pendingItemsState.items = []
})

describe('HomeScreen pending + empty-state coexistence', () => {
  it('suppresses the no-transactions empty state while a pending request leads the list', () => {
    pendingItemsState.items = [makePendingRequest()]
    renderScreen()

    expect(screen.queryByText('home.noTransactions')).toBeNull()
  })

  it('shows the empty state when there are no transactions and no pending items', () => {
    renderScreen()

    expect(screen.getByText('home.noTransactions')).toBeTruthy()
  })

  it('shows settled transactions alongside a pending request without the empty state', () => {
    pendingItemsState.items = [makePendingRequest()]
    const tx: Transaction = {
      id: 't1',
      direction: 'receive',
      method: 'ecash',
      protocol: 'cashu',
      status: 'settled',
      amount: sat(500),
      accountId: 'https://mint.test',
      createdAt: Date.now(),
    }
    renderScreen({ transactions: [tx] })

    expect(screen.queryByText('home.noTransactions')).toBeNull()
  })
})
