import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { usePullToRefresh } from '@/hooks/use-pull-to-refresh'

describe('usePullToRefresh', () => {
  let onRefresh: () => Promise<void>

  beforeEach(() => {
    onRefresh = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should return initial state', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh })
    )

    expect(result.current.isRefreshing).toBe(false)
    expect(result.current.scrollContainerRef).toBeDefined()
    expect(result.current.indicatorRef).toBeDefined()
  })

  it('should not be refreshing initially', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh })
    )

    expect(result.current.isRefreshing).toBe(false)
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('should provide refs for DOM attachment', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 40, maxPull: 100 })
    )

    expect(typeof result.current.scrollContainerRef).toBe('object')
    expect(typeof result.current.indicatorRef).toBe('object')
    expect(typeof result.current.isRefreshing).toBe('boolean')
  })

  it('should accept custom threshold and maxPull', () => {
    const { result } = renderHook(() =>
      usePullToRefresh({ onRefresh, threshold: 60, maxPull: 200 })
    )

    // Hook should initialize without errors
    expect(result.current.isRefreshing).toBe(false)
  })

  it('should not call onRefresh without user interaction', () => {
    renderHook(() => usePullToRefresh({ onRefresh }))

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('should clean up listeners on unmount', () => {
    const { unmount } = renderHook(() =>
      usePullToRefresh({ onRefresh })
    )

    // Should not throw on unmount
    expect(() => unmount()).not.toThrow()
  })
})
