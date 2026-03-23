import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSyncAfterRecovery, totalRecoveredCount, type RecoverAllResult } from '@/hooks/use-sync-after-recovery'

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

vi.mock('@/coco/cashuService', () => ({
  getActivePendingQuotes: vi.fn().mockResolvedValue([{ quoteId: 'q1' }]),
}))

const mockAddToast = vi.fn()
const mockSetPendingQuotes = vi.fn()
let mockRefreshAll: () => Promise<void>

function makeRecovery(overrides: Partial<Record<string, Record<string, number>>> = {}): RecoverAllResult {
  return {
    quotes: { recovered: 0, failed: 0, expired: 0 },
    melts: { recovered: 0, failed: 0 },
    sendTokens: { reclaimed: 0, recorded: 0 },
    receivedTokens: { redeemed: 0, failed: 0 },
    httpReceives: { recovered: 0 },
    ...overrides,
  } as RecoverAllResult
}

describe('totalRecoveredCount', () => {
  it('should return 0 when all counters are zero', () => {
    expect(totalRecoveredCount(makeRecovery())).toBe(0)
  })

  it('should sum recovered counts across all categories', () => {
    const recovery = makeRecovery({
      quotes: { recovered: 2, failed: 1, expired: 0 },
      melts: { recovered: 1, failed: 0 },
      sendTokens: { reclaimed: 3, recorded: 0 },
      receivedTokens: { redeemed: 4, failed: 1 },
    })
    expect(totalRecoveredCount(recovery)).toBe(10) // 2 + 1 + 3 + 4
  })

  it('should count only recovered/reclaimed/redeemed, not failed/expired', () => {
    const recovery = makeRecovery({
      quotes: { recovered: 0, failed: 5, expired: 3 },
      melts: { recovered: 0, failed: 2 },
      sendTokens: { reclaimed: 0, recorded: 1 },
      receivedTokens: { redeemed: 0, failed: 4 },
    })
    expect(totalRecoveredCount(recovery)).toBe(0)
  })
})

describe('notifyRecovery', () => {
  beforeEach(() => {
    mockRefreshAll = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    vi.clearAllMocks()
  })

  it('should show toast when receivedTokens.redeemed > 0', () => {
    const { result } = renderHook(() =>
      useSyncAfterRecovery({ refreshAll: mockRefreshAll })
    )

    act(() => {
      result.current.notifyRecovery(makeRecovery({
        receivedTokens: { redeemed: 3, failed: 0 },
      }))
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
      result.current.notifyRecovery(makeRecovery())
    })

    expect(mockAddToast).not.toHaveBeenCalled()
  })

  it('should not show toast when recovery has non-zero total but redeemed is 0', () => {
    const { result } = renderHook(() =>
      useSyncAfterRecovery({ refreshAll: mockRefreshAll })
    )

    act(() => {
      result.current.notifyRecovery(makeRecovery({
        quotes: { recovered: 2, failed: 0, expired: 0 },
      }))
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
    const cashuService = await import('@/coco/cashuService')
    vi.mocked(cashuService.getActivePendingQuotes).mockRejectedValueOnce(new Error('DB error'))
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

    expect(mockAddToast).not.toHaveBeenCalled() // null → no toast
    expect(mockRefreshAll).toHaveBeenCalledOnce()
    expect(broadcastSync).toHaveBeenCalledWith('balance_changed')
    expect(mockSetPendingQuotes).toHaveBeenCalledWith([{ quoteId: 'q1' }])
  })

  it('should show toast and sync when recovery has redeemed tokens', async () => {
    const { result } = renderHook(() =>
      useSyncAfterRecovery({ refreshAll: mockRefreshAll })
    )

    const recovery = makeRecovery({
      receivedTokens: { redeemed: 5, failed: 0 },
    })

    await act(async () => {
      await result.current.syncAfterRecovery(recovery)
    })

    expect(mockAddToast).toHaveBeenCalledOnce()
    expect(mockRefreshAll).toHaveBeenCalledOnce()
    expect(mockSetPendingQuotes).toHaveBeenCalledOnce()
  })
})
