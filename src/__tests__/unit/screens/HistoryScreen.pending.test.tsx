import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const stableT = (key: string, opts?: Record<string, unknown>) => {
  if (opts && typeof opts === 'object') {
    let out = key
    for (const [k, v] of Object.entries(opts)) {
      out = out.replace(`{{${k}}}`, String(v))
    }
    return out
  }
  return key
}

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
    useFormatSats: () => (v: number) => `${v} sats`,
    useFormatFiat: () => () => null,
  }
})

const addToastMock = vi.fn()
const triggerTxRefreshMock = vi.fn()
const storeState: {
  addToast: typeof addToastMock
  triggerTxRefresh: typeof triggerTxRefreshMock
  settings: Record<string, unknown>
  allRates: Record<string, number>
} = {
  addToast: addToastMock,
  triggerTxRefresh: triggerTxRefreshMock,
  settings: { mints: ['https://mint.test'], mintAliases: {}, fiatCurrency: 'USD' },
  allRates: {},
}
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(storeState),
}))

const pendingItemsState: { items: Array<Record<string, unknown>>; isLoading: boolean } = {
  items: [],
  isLoading: false,
}
vi.mock('@/ui/hooks/usePendingItems', () => ({
  useAllPendingItems: () => ({
    items: pendingItemsState.items,
    isLoading: pendingItemsState.isLoading,
    refresh: () => Promise.resolve(),
  }),
}))

vi.mock('@/ui/hooks', () => ({
  useWallet: () => ({ balance: { total: 0, byMint: {} } }),
  useMintMetadata: () => ({
    metadataMap: new Map(),
    isLoading: false,
    getDisplayName: (url: string) => url || '—',
    getOriginalName: (url: string) => url || '—',
    getIconUrl: () => undefined,
    getMetadata: () => undefined,
    refreshMetadata: () => Promise.resolve(),
  }),
}))

vi.mock('@/ui/hooks/useReclaimFees', () => ({
  // Quoted fee present — the sheet gates its confirm button on known fees.
  useReclaimFees: () => ({ fees: new Map([['p1', 2]]), isLoading: false }),
}))

const reclaimMultipleMock = vi.fn(
  async (_ids: string[], options?: { onSuccess?: () => void }) => {
    options?.onSuccess?.()
    return { success: true }
  },
)
vi.mock('@/ui/hooks/use-token-reclaim', () => ({
  useTokenReclaim: () => ({
    reclaimToken: vi.fn(),
    reclaimMultiple: reclaimMultipleMock,
  }),
}))

vi.mock('@/ui/screens/TransactionDetail/TransactionDetailScreen', () => ({
  default: ({ transaction }: { transaction: { id: string } }) => (
    <div>{`detail:${transaction.id}`}</div>
  ),
}))

import { HistoryScreen } from '@/ui/screens/History/HistoryScreen'
import type { Transaction } from '@/core/domain/transaction'

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

function makeSendTokenItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    direction: 'send',
    kind: 'token',
    amount: 1000,
    accountId: 'https://mint.test',
    createdAt: Date.now(),
    memo: '커피값',
    details: { token: 'cashuAeyJ0b2tlbiI6Ii4uLiJ9' },
    ...overrides,
  }
}

const renderScreen = (
  props: Partial<React.ComponentProps<typeof HistoryScreen>> = {},
) =>
  render(
    <HistoryScreen onBack={() => {}} transactions={[]} {...props} />,
  )

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  pendingItemsState.items = []
  pendingItemsState.isLoading = false
})

describe('HistoryScreen pending ecash section', () => {
  it('renders PendingWidget + ReclaimableSection when a pending send token exists', () => {
    pendingItemsState.items = [makeSendTokenItem()]
    renderScreen()

    expect(screen.getByText('token.pendingWidget.title')).toBeTruthy()
    expect(screen.getByText('token.reclaimable.section')).toBeTruthy()
    expect(screen.getByText('커피값')).toBeTruthy()
  })

  it('suppresses the no-transactions empty state while pending exists', () => {
    pendingItemsState.items = [makeSendTokenItem()]
    renderScreen()

    expect(screen.queryByText('history.noTransactions')).toBeNull()
  })

  it('suppresses the empty state while pending items are still loading', () => {
    pendingItemsState.isLoading = true
    renderScreen()

    expect(screen.queryByText('history.noTransactions')).toBeNull()
  })

  it('shows the empty state when there is no pending and loading settled', () => {
    renderScreen()

    expect(screen.getByText('history.noTransactions')).toBeTruthy()
  })

  it('hides the pending section while searching', () => {
    pendingItemsState.items = [makeSendTokenItem()]
    renderScreen()

    fireEvent.change(screen.getByPlaceholderText('history.searchPlaceholder'), {
      target: { value: 'coffee' },
    })

    expect(screen.queryByText('token.pendingWidget.title')).toBeNull()
  })

  it('keeps pending visible under a mint filter that differs only by trailing slash', () => {
    pendingItemsState.items = [makeSendTokenItem({ accountId: 'https://mint.test' })]
    renderScreen({ initialMintUrls: ['https://mint.test/'] })

    expect(screen.getByText('token.pendingWidget.title')).toBeTruthy()
  })

  it('excludes non-send pending items (receive requests) from the section', () => {
    pendingItemsState.items = [
      makeSendTokenItem({ id: 'r1', direction: 'receive', kind: 'request' }),
    ]
    renderScreen()

    expect(screen.queryByText('token.pendingWidget.title')).toBeNull()
  })

  it('opens the reclaim sheet from a card and confirms through reclaimMultiple', async () => {
    pendingItemsState.items = [makeSendTokenItem()]
    renderScreen()

    fireEvent.click(screen.getByText('token.reclaimable.actions.reclaim'))
    expect(screen.getByText('token.reclaim.title')).toBeTruthy()

    fireEvent.click(screen.getByText('token.reclaim.confirm'))
    await waitFor(() => {
      expect(reclaimMultipleMock).toHaveBeenCalledWith(['p1'], expect.anything())
    })
  })

  it('shares the raw token string through navigator.share when available', async () => {
    pendingItemsState.items = [makeSendTokenItem()]
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', {
      value: share,
      configurable: true,
    })
    try {
      renderScreen()

      fireEvent.click(screen.getByLabelText('token.reclaimable.actions.share'))

      await waitFor(() => {
        expect(share).toHaveBeenCalledWith({ text: 'cashuAeyJ0b2tlbiI6Ii4uLiJ9' })
      })
    } finally {
      Object.defineProperty(navigator, 'share', {
        value: undefined,
        configurable: true,
      })
    }
  })

  it('falls back to clipboard + toast when navigator.share is unavailable', async () => {
    pendingItemsState.items = [makeSendTokenItem()]
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    renderScreen()

    fireEvent.click(screen.getByLabelText('token.reclaimable.actions.share'))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('cashuAeyJ0b2tlbiI6Ii4uLiJ9')
    })
    expect(addToastMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    )
  })

  it('opens the inline transaction detail when the pending tx is in the window', async () => {
    pendingItemsState.items = [makeSendTokenItem()]
    const pendingTx = {
      id: 'p1',
      direction: 'send',
      method: 'cashu',
      protocol: 'cashu-token',
      amount: { value: 1000n, unit: 'sat' },
      accountId: 'https://mint.test',
      status: 'pending',
      outcome: 'unclaimed',
      createdAt: Date.now(),
    } as unknown as Transaction
    renderScreen({ transactions: [pendingTx] })

    fireEvent.click(screen.getByText('커피값'))

    await waitFor(() => {
      expect(screen.getByText('detail:p1')).toBeTruthy()
    })
  })

  it('falls back to an error toast when no transaction backs the pending card', async () => {
    // Legacy pending rows can outlive their transaction; without a registry
    // the lookup must fail loudly, not no-op.
    pendingItemsState.items = [makeSendTokenItem()]
    renderScreen({ transactions: [] })

    fireEvent.click(screen.getByText('커피값'))

    await waitFor(() => {
      expect(addToastMock).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'error' }),
      )
    })
    expect(screen.queryByText('detail:p1')).toBeNull()
  })
})
