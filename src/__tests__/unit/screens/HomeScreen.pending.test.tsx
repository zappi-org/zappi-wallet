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

  it('excludes a reclaimable (pending+unclaimed) send transaction from the ledger — its pending row already carries that money', () => {
    const reclaimableTx: Transaction = {
      id: 'tx-send1',
      direction: 'send',
      method: 'cashu-token',
      protocol: 'cashu-token',
      status: 'pending',
      outcome: 'unclaimed',
      amount: sat(777),
      accountId: 'https://mint.test',
      createdAt: Date.now(),
    }
    pendingItemsState.items = [{
      id: reclaimableTx.id, // same id contract as composition/pending-items.ts
      direction: 'send',
      kind: 'token',
      amount: 777,
      accountId: 'https://mint.test',
      createdAt: Date.now(),
      details: { token: 'cashuAxyz' },
    }]
    renderScreen({ transactions: [reclaimableTx] })

    // One row for the -777 amount (from PendingItemsList) — the reclaimable-send
    // transaction itself must not also surface in the ledger below it.
    expect(screen.getAllByText('-777 sats')).toHaveLength(1)
  })

  it('still shows a reclaimable send transaction in the ledger while its pending item has not loaded yet', () => {
    // Pending query is async/independent and hasn't resolved (or came back
    // empty) — the tx must not vanish from both lists while that's true.
    pendingItemsState.items = []
    const reclaimableTx: Transaction = {
      id: 'tx-send-unloaded',
      direction: 'send',
      method: 'cashu-token',
      protocol: 'cashu-token',
      status: 'pending',
      outcome: 'unclaimed',
      amount: sat(555),
      accountId: 'https://mint.test',
      createdAt: Date.now(),
    }
    renderScreen({ transactions: [reclaimableTx] })

    expect(screen.getByText('-555 sats')).toBeInTheDocument()
  })

  it('shows a transaction stored under a URL notation variant of the selected mint', () => {
    // Same mint, different notation (host case + explicit :443 + trailing slash).
    // A slash-only comparison would drop this row and the money would look lost.
    const variantTx: Transaction = {
      id: 'tx-variant',
      direction: 'send',
      method: 'cashu-token',
      protocol: 'cashu-token',
      status: 'settled',
      outcome: 'claimed',
      amount: sat(444),
      accountId: 'https://MINT.test:443/',
      createdAt: Date.now(),
    }
    renderScreen({ transactions: [variantTx] })

    expect(screen.getByText('-444 sats')).toBeInTheDocument()
  })

  it('still excludes a transaction belonging to a different mint', () => {
    const foreignTx: Transaction = {
      id: 'tx-foreign',
      direction: 'send',
      method: 'cashu-token',
      protocol: 'cashu-token',
      status: 'settled',
      outcome: 'claimed',
      amount: sat(999),
      accountId: 'https://other-mint.test',
      createdAt: Date.now(),
    }
    renderScreen({ transactions: [foreignTx] })

    expect(screen.queryByText('-999 sats')).toBeNull()
  })

  it('shows a pending item stored under a URL notation variant of the selected mint', () => {
    pendingItemsState.items = [
      makePendingRequest({ id: 'req-variant', accountId: 'https://MINT.test:443/', amount: 1234 }),
    ]
    renderScreen()

    expect(screen.getByText('+1234 sats')).toBeInTheDocument()
  })

  it('still shows a settled send transaction in the ledger (dedup only targets reclaimable rows)', () => {
    pendingItemsState.items = []
    const settledTx: Transaction = {
      id: 'tx-settled',
      direction: 'send',
      method: 'cashu-token',
      protocol: 'cashu-token',
      status: 'settled',
      outcome: 'claimed',
      amount: sat(321),
      accountId: 'https://mint.test',
      createdAt: Date.now(),
    }
    renderScreen({ transactions: [settledTx] })

    expect(screen.getByText('-321 sats')).toBeInTheDocument()
  })
})
