import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createRef } from 'react'
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
const storeState: {
  addToast: typeof addToastMock
  settings: Record<string, unknown>
  allRates: Record<string, number>
  balance: { total: number; byMint: Record<string, number> }
  mints: Array<Record<string, unknown>>
  isLoadingBalance: boolean
  activeMintUrl: string | null
} = {
  addToast: addToastMock,
  settings: { mints: [], fiatCurrency: 'USD', pendingEmptyDismissedAt: null },
  allRates: {},
  balance: { total: 0, byMint: {} },
  mints: [],
  isLoadingBalance: false,
  activeMintUrl: null,
}
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(storeState),
}))

const pendingItemsState: { items: Array<Record<string, unknown>> } = { items: [] }
vi.mock('@/ui/hooks/usePendingItems', () => ({
  useAllPendingItems: () => ({
    items: pendingItemsState.items,
    isLoading: false,
    refresh: () => Promise.resolve(),
  }),
}))

vi.mock('@/ui/hooks/use-mint-metadata', () => ({
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
  useReclaimFees: () => ({ fees: new Map(), isLoading: false }),
}))

const txHistoryState: { groups: Array<Record<string, unknown>> } = { groups: [] }
vi.mock('@/ui/hooks/use-transaction-history', () => ({
  useTransactionHistory: () => ({
    groups: txHistoryState.groups,
    isLoading: false,
    error: undefined,
    refresh: () => Promise.resolve(),
  }),
}))

vi.mock('@/ui/hooks/use-service-registry', () => ({
  useServiceRegistry: () => ({
    payment: { recoverAll: () => Promise.resolve([]) },
  }),
}))

import { TokenScreen } from '@/ui/screens/Token/TokenScreen'

function setPending(items: Array<Record<string, unknown>>) {
  pendingItemsState.items = items
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

function setTimelineWithSendClaimed(completedAt: number | undefined) {
  txHistoryState.groups = [
    {
      key: 'today-2026-4-28',
      kind: 'today',
      year: 2026,
      month: 4,
      day: 28,
      refDate: completedAt ?? Date.now(),
      entries: [
        {
          id: 'tx-claimed',
          direction: 'send',
          method: 'cashu',
          protocol: 'cashu-token',
          amount: { unit: 'sat', value: 1000n },
          accountId: 'https://mint.test',
          status: 'settled',
          outcome: 'claimed',
          createdAt: completedAt ?? Date.now(),
          completedAt,
        },
      ],
    },
  ]
}

const renderScreen = (
  props: Partial<React.ComponentProps<typeof TokenScreen>> = {},
) => {
  const ref = createRef<HTMLDivElement>()
  return render(<TokenScreen scrollRef={ref} {...props} />)
}

describe('TokenScreen', () => {
  beforeEach(() => {
    cleanup()
    addToastMock.mockClear()
    setPending([])
    txHistoryState.groups = []
    storeState.settings = { mints: [], fiatCurrency: 'USD', pendingEmptyDismissedAt: null }
    storeState.allRates = {}
  })

  it('no pending + no timeline → shows only empty state', () => {
    renderScreen()
    expect(screen.getByText(/token\.empty\.title/)).toBeInTheDocument()
    expect(screen.queryByText(/token\.reclaimable\.section/)).not.toBeInTheDocument()
    expect(screen.queryByText(/token\.history\.section/)).not.toBeInTheDocument()
  })

  it('renders PendingWidget + ReclaimableSection when pending data exists', () => {
    setPending([makeSendTokenItem()])
    renderScreen()
    expect(screen.getByText(/token\.pendingWidget\.title/)).toBeInTheDocument()
    expect(screen.getByText(/token\.reclaimable\.section/)).toBeInTheDocument()
  })

  it('auto-shows first-create hint when 1 pending and no timeline', () => {
    setPending([makeSendTokenItem()])
    renderScreen()
    expect(screen.getByText(/token\.firstCreate\.hint/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/token\.firstCreate\.dismiss/))
    expect(screen.queryByText(/token\.firstCreate\.hint/)).not.toBeInTheDocument()
  })

  it('calls navigator.share when share button clicked', async () => {
    const shareSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', {
      value: shareSpy,
      configurable: true,
      writable: true,
    })

    setPending([makeSendTokenItem()])
    renderScreen()
    fireEvent.click(screen.getAllByLabelText(/token\.reclaimable\.actions\.share/)[0])

    await waitFor(() => expect(shareSpy).toHaveBeenCalledTimes(1))
    const arg = shareSpy.mock.calls[0][0]
    expect(arg).toHaveProperty('text')

    delete (navigator as unknown as { share?: unknown }).share
  })

  it('falls back to clipboard and shows toast when navigator.share unavailable', async () => {
    delete (navigator as unknown as { share?: unknown }).share

    const writeTextSpy = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextSpy },
      configurable: true,
      writable: true,
    })

    setPending([makeSendTokenItem()])
    renderScreen()
    fireEvent.click(screen.getAllByLabelText(/token\.reclaimable\.actions\.share/)[0])

    await waitFor(() => expect(writeTextSpy).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(addToastMock).toHaveBeenCalledTimes(1))
    expect(addToastMock.mock.calls[0][0]).toMatchObject({ type: 'success' })
  })

  it('maintains detail data generation even when fiat display is off', () => {
    storeState.settings = {
      mints: [],
      fiatCurrency: 'USD',
      showFiatConversion: false,
      pendingEmptyDismissedAt: null,
    }
    storeState.allRates = { USD: 100_000 }
    setPending([makeSendTokenItem()])
    const onSelectToken = vi.fn()

    renderScreen({ onSelectToken })
    fireEvent.click(screen.getByText('커피값'))

    expect(onSelectToken).toHaveBeenCalledTimes(1)
    expect(onSelectToken.mock.calls[0][0]).toMatchObject({
      fiat: { amount: 1, currency: 'USD' },
    })
  })

  describe('PendingEmptyWidget', () => {
    it('shows widget when 0 pending + has timeline + dismissedAt null', () => {
      setTimelineWithSendClaimed(Date.now() - 1000)
      renderScreen()
      expect(screen.getByText(/token\.pendingEmpty\.title/)).toBeInTheDocument()
      expect(screen.getByText(/common\.close/)).toBeInTheDocument()
    })

    it('calls onSaveSettings({pendingEmptyDismissedAt}) on close click', () => {
      const before = Date.now()
      setTimelineWithSendClaimed(before - 1000)
      const onSaveSettings = vi.fn().mockResolvedValue(undefined)
      renderScreen({ onSaveSettings })

      fireEvent.click(screen.getByText(/common\.close/))

      expect(onSaveSettings).toHaveBeenCalledTimes(1)
      const updates = onSaveSettings.mock.calls[0][0] as Record<string, number>
      expect(updates).toHaveProperty('pendingEmptyDismissedAt')
      expect(updates.pendingEmptyDismissedAt).toBeGreaterThanOrEqual(before)
    })

    it('hides widget when no send-claimed after dismissedAt', () => {
      const dismissed = Date.now()
      storeState.settings = {
        mints: [],
        fiatCurrency: 'USD',
        pendingEmptyDismissedAt: dismissed,
      }
      setTimelineWithSendClaimed(dismissed - 5000) // 이전 claim
      renderScreen()
      expect(screen.queryByText(/token\.pendingEmpty\.title/)).not.toBeInTheDocument()
    })

    it('shows widget again when send-claimed occurs after dismissedAt', () => {
      const dismissed = Date.now() - 10000
      storeState.settings = {
        mints: [],
        fiatCurrency: 'USD',
        pendingEmptyDismissedAt: dismissed,
      }
      setTimelineWithSendClaimed(dismissed + 5000) // 이후 claim
      renderScreen()
      expect(screen.getByText(/token\.pendingEmpty\.title/)).toBeInTheDocument()
    })

    it('excludes send-claimed without completedAt from trigger', () => {
      storeState.settings = {
        mints: [],
        fiatCurrency: 'USD',
        pendingEmptyDismissedAt: Date.now() - 10000,
      }
      setTimelineWithSendClaimed(undefined)
      renderScreen()
      expect(screen.queryByText(/token\.pendingEmpty\.title/)).not.toBeInTheDocument()
    })
  })
})
