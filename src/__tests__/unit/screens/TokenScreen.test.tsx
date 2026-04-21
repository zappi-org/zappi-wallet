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
const defaultStoreState = {
  addToast: addToastMock,
  settings: { mints: [], fiatCurrency: 'USD' },
  allRates: {},
}
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(defaultStoreState),
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

vi.mock('@/ui/hooks/use-transaction-history', () => ({
  useTransactionHistory: () => ({
    groups: [],
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

const renderScreen = () => {
  const ref = createRef<HTMLDivElement>()
  return render(<TokenScreen scrollRef={ref} />)
}

describe('TokenScreen', () => {
  beforeEach(() => {
    cleanup()
    addToastMock.mockClear()
    setPending([])
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
})
