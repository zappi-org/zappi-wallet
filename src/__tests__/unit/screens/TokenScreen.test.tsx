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
} = {
  addToast: addToastMock,
  settings: { mints: [], fiatCurrency: 'USD', pendingEmptyDismissedAt: null },
  allRates: {},
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
  })

  it('no pending + no timeline → empty state 만 보여준다', () => {
    renderScreen()
    expect(screen.getByText(/token\.empty\.title/)).toBeInTheDocument()
    expect(screen.queryByText(/token\.reclaimable\.section/)).not.toBeInTheDocument()
    expect(screen.queryByText(/token\.history\.section/)).not.toBeInTheDocument()
  })

  it('pending 실데이터가 있으면 PendingWidget + ReclaimableSection 렌더', () => {
    setPending([makeSendTokenItem()])
    renderScreen()
    expect(screen.getByText(/token\.pendingWidget\.title/)).toBeInTheDocument()
    expect(screen.getByText(/token\.reclaimable\.section/)).toBeInTheDocument()
  })

  it('pending 1개 + timeline 없음 → first-create hint 자동 표시', () => {
    setPending([makeSendTokenItem()])
    renderScreen()
    expect(screen.getByText(/token\.firstCreate\.hint/)).toBeInTheDocument()
    fireEvent.click(screen.getByText(/token\.firstCreate\.dismiss/))
    expect(screen.queryByText(/token\.firstCreate\.hint/)).not.toBeInTheDocument()
  })

  it('공유 버튼 클릭 시 navigator.share를 호출한다', async () => {
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

  it('navigator.share 없으면 clipboard로 폴백하고 토스트를 띄운다', async () => {
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

  describe('PendingEmptyWidget', () => {
    it('pending 0 + timeline 있음 + dismissedAt null → 위젯 노출', () => {
      setTimelineWithSendClaimed(Date.now() - 1000)
      renderScreen()
      expect(screen.getByText(/token\.pendingEmpty\.title/)).toBeInTheDocument()
      expect(screen.getByText(/common\.close/)).toBeInTheDocument()
    })

    it('닫기 클릭 → onSaveSettings({pendingEmptyDismissedAt}) 호출', () => {
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

    it('dismissedAt 이후 send-claimed 없음 → 위젯 숨김', () => {
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

    it('dismissedAt 이후 send-claimed 발생 → 위젯 다시 노출', () => {
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

    it('completedAt 없는 send-claimed는 트리거에서 제외', () => {
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
