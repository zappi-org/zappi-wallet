import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSyncAfterRecovery, totalRecoveredCount } from '@/hooks/use-sync-after-recovery'
import type { RecoveryReport } from '@/core/ports/driving/payment.usecase'

// Mock ServiceContext — vi.hoisted를 사용하여 hoisting 문제 해결
const { mockGetActivePendingQuotes } = vi.hoisted(() => ({
  mockGetActivePendingQuotes: vi.fn().mockResolvedValue([{ quoteId: 'q1' }]),
}))
vi.mock('@/hooks/service-context-value', async () => {
  const { createContext } = await import('react')
  return {
    ServiceContext: createContext({
      pendingItems: {
        getActivePendingQuotes: mockGetActivePendingQuotes,
        getByMint: vi.fn().mockResolvedValue([]),
        getAll: vi.fn().mockResolvedValue([]),
      },
    }),
  }
})

// Mock dependencies
vi.mock('@/store', () => ({
  useAppStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      addToast: mockAddToast,
      setPendingQuotes: mockSetPendingQuotes,
    }
    return selector(state)
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => `${key}${opts ? `:${JSON.stringify(opts)}` : ''}`,
  }),
}))

vi.mock('@/hooks/use-cross-tab-sync', () => ({
  broadcastSync: vi.fn(),
}))


const mockAddToast = vi.fn()
const mockSetPendingQuotes = vi.fn()
let mockRefreshAll: () => Promise<void>

function makeReports(...items: Array<Partial<RecoveryReport>>): RecoveryReport[] {
  return items.map((item) => ({
    moduleId: item.moduleId ?? 'cashu',
    recovered: item.recovered ?? 0,
    failed: item.failed ?? 0,
  }))
}

describe('totalRecoveredCount', () => {
  it('should return 0 for empty array', () => {
    expect(totalRecoveredCount([])).toBe(0)
  })

  it('should return 0 when all recovered counts are zero', () => {
    expect(totalRecoveredCount(makeReports({ recovered: 0 }, { recovered: 0 }))).toBe(0)
  })

  it('should sum recovered counts across all reports', () => {
    const reports = makeReports(
      { moduleId: 'cashu:bolt11', recovered: 2, failed: 1 },
      { moduleId: 'cashu:ecash', recovered: 3, failed: 0 },
    )
    expect(totalRecoveredCount(reports)).toBe(5)
  })
})

describe('notifyRecovery', () => {
  beforeEach(() => {
    mockRefreshAll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    vi.clearAllMocks()
  })

  it('should show toast when total recovered > 0', () => {
    const { result } = renderHook(() =>
      useSyncAfterRecovery({ refreshAll: mockRefreshAll })
    )

    act(() => {
      result.current.notifyRecovery(makeReports({ recovered: 3 }))
    })

    expect(mockAddToast).toHaveBeenCalledWith({
      type: 'success',
      message: expect.stringContaining('toast.offlineTokensRedeemed'),
      duration: 4000,
    })
  })

  it('should not show toast when recovery is null', () => {
    const { result } = renderHook(() =>
      useSyncAfterRecovery({ refreshAll: mockRefreshAll })
    )

    act(() => {
      result.current.notifyRecovery(null)
    })

    expect(mockAddToast).not.toHaveBeenCalled()
  })

  it('should not show toast when totalRecoveredCount is 0', () => {
    const { result } = renderHook(() =>
      useSyncAfterRecovery({ refreshAll: mockRefreshAll })
    )

    act(() => {
      result.current.notifyRecovery(makeReports({ recovered: 0, failed: 3 }))
    })

    expect(mockAddToast).not.toHaveBeenCalled()
  })
})

describe('syncPendingQuotes', () => {
  beforeEach(() => {
    mockRefreshAll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should load and set pending quotes', async () => {
    const { result } = renderHook(() =>
      useSyncAfterRecovery({ refreshAll: mockRefreshAll })
    )

    await act(async () => {
      await result.current.syncPendingQuotes()
    })

    expect(mockSetPendingQuotes).toHaveBeenCalledWith([{ quoteId: 'q1' }])
  })

  it('should swallow errors gracefully', async () => {
    mockGetActivePendingQuotes.mockRejectedValueOnce(new Error('DB error'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() =>
      useSyncAfterRecovery({ refreshAll: mockRefreshAll })
    )

    await act(async () => {
      await result.current.syncPendingQuotes()
    })

    expect(consoleSpy).toHaveBeenCalledWith(
      '[Sync] Failed to sync pending quotes:',
      expect.any(Error)
    )
    consoleSpy.mockRestore()
  })
})

describe('syncAfterRecovery', () => {
  beforeEach(() => {
    mockRefreshAll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should call notify, refreshAll, broadcastSync, and syncPendingQuotes in order', async () => {
    const { broadcastSync } = await import('@/hooks/use-cross-tab-sync')
    const { result } = renderHook(() =>
      useSyncAfterRecovery({ refreshAll: mockRefreshAll })
    )

    await act(async () => {
      await result.current.syncAfterRecovery(null)
    })

    expect(mockAddToast).not.toHaveBeenCalled()
    expect(mockRefreshAll).toHaveBeenCalledOnce()
    expect(broadcastSync).toHaveBeenCalledWith('balance_changed')
    expect(mockSetPendingQuotes).toHaveBeenCalledWith([{ quoteId: 'q1' }])
  })

  it('should show toast and sync when recovery has recovered items', async () => {
    const { result } = renderHook(() =>
      useSyncAfterRecovery({ refreshAll: mockRefreshAll })
    )

    await act(async () => {
      await result.current.syncAfterRecovery(makeReports({ recovered: 5 }))
    })

    expect(mockAddToast).toHaveBeenCalledOnce()
    expect(mockRefreshAll).toHaveBeenCalledOnce()
    expect(mockSetPendingQuotes).toHaveBeenCalledOnce()
  })
})
