import { useRef, useState, useCallback, useEffect } from 'react'

interface UsePullToRefreshOptions {
  /** Async callback to execute when refresh is triggered */
  onRefresh: () => Promise<void>
  /** Pull distance (px) required to trigger refresh */
  threshold?: number
  /** Maximum pull distance (px) with damping */
  maxPull?: number
}

interface UsePullToRefreshReturn {
  scrollContainerRef: React.RefObject<HTMLElement | null>
  /** Current pull distance in px (0 when not pulling) */
  pullDistance: number
  /** Whether the user is actively dragging */
  isPulling: boolean
  /** Whether a refresh is currently in progress */
  isRefreshing: boolean
  /** Whether the indicator is animating away after refresh completes */
  isDismissing: boolean
}

/**
 * Touch-based pull-to-refresh hook for scrollable containers.
 * Attach scrollContainerRef to the scrollable element.
 * Only activates when scrollTop === 0 and user drags downward.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  maxPull = 120,
}: UsePullToRefreshOptions): UsePullToRefreshReturn {
  const scrollContainerRef = useRef<HTMLElement>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [isPulling, setIsPulling] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDismissing, setIsDismissing] = useState(false)

  // Mutable refs — avoid re-creating callbacks on every state change
  const startYRef = useRef(0)
  const trackingRef = useRef(false)
  const pullDistanceRef = useRef(0)
  const isRefreshingRef = useRef(false)
  const rafRef = useRef(0)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  // Cleanup RAF on unmount
  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const el = scrollContainerRef.current
    if (!el || el.scrollTop > 0 || isRefreshingRef.current) return

    startYRef.current = e.touches[0].clientY
    trackingRef.current = true
    setIsPulling(true)
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (!trackingRef.current) return

    const deltaY = e.touches[0].clientY - startYRef.current
    if (deltaY < 0) {
      // Scrolling up — stop tracking
      trackingRef.current = false
      pullDistanceRef.current = 0
      cancelAnimationFrame(rafRef.current)
      setPullDistance(0)
      setIsPulling(false)
      return
    }

    const damped = Math.min(deltaY * 0.5, maxPull)
    if (damped > 0) {
      e.preventDefault()
    }
    pullDistanceRef.current = damped
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => setPullDistance(damped))
  }, [maxPull])

  const handleTouchEnd = useCallback(async () => {
    const currentPull = pullDistanceRef.current
    if (!trackingRef.current && !currentPull) return
    trackingRef.current = false
    pullDistanceRef.current = 0
    setIsPulling(false)

    if (currentPull >= threshold && !isRefreshingRef.current) {
      isRefreshingRef.current = true
      setIsRefreshing(true)
      setPullDistance(0)
      try {
        await onRefreshRef.current()
      } catch (e) {
        console.error('[PullToRefresh] Refresh failed:', e)
      } finally {
        // Dismiss animation — set isDismissing briefly before fully hiding
        setIsDismissing(true)
        // Wait for CSS transition to complete before unmounting
        await new Promise((r) => setTimeout(r, 250))
        isRefreshingRef.current = false
        setIsRefreshing(false)
        setIsDismissing(false)
      }
    } else {
      setPullDistance(0)
    }
  }, [threshold])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd)

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd])

  return { scrollContainerRef, pullDistance, isPulling, isRefreshing, isDismissing }
}
