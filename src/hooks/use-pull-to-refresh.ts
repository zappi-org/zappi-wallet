import { useRef, useState, useCallback, useEffect } from 'react'

interface UsePullToRefreshOptions {
  /** Async callback to execute when refresh is triggered */
  onRefresh: () => Promise<void>
  /** Pull distance (px) required to trigger refresh */
  threshold?: number
  /** Maximum pull distance (px) — asymptotic limit for exponential damping */
  maxPull?: number
}

interface UsePullToRefreshReturn {
  scrollContainerRef: React.RefObject<HTMLElement | null>
  /** Current pull distance in px (0 when not pulling) */
  pullDistance: number
  /** Whether the user is actively dragging */
  isPulling: boolean
  /** Whether pull has crossed the trigger threshold */
  pastThreshold: boolean
  /** Whether a refresh is currently in progress */
  isRefreshing: boolean
  /** Whether the indicator is animating away after refresh completes */
  isDismissing: boolean
  /** Bind to indicator's onTransitionEnd to finalize dismiss */
  handleDismissEnd: (e: React.TransitionEvent) => void
}

/** Exponential damping — feels like a spring. Asymptotically approaches maxPull. */
function applyDamping(rawDelta: number, maxPull: number): number {
  const k = 0.4
  return maxPull * (1 - Math.exp((-k * rawDelta) / maxPull))
}

/**
 * Touch-based pull-to-refresh hook for scrollable containers.
 * Attach scrollContainerRef to the scrollable element.
 * Only activates when scrollTop === 0 and user drags downward.
 */
export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  maxPull = 128,
}: UsePullToRefreshOptions): UsePullToRefreshReturn {
  const scrollContainerRef = useRef<HTMLElement>(null)
  const [pullDistance, setPullDistance] = useState(0)
  const [isPulling, setIsPulling] = useState(false)
  const [pastThreshold, setPastThreshold] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isDismissing, setIsDismissing] = useState(false)

  // Mutable refs — avoid re-creating callbacks on every state change
  const startYRef = useRef(0)
  const trackingRef = useRef(false)
  const pullDistanceRef = useRef(0)
  const isRefreshingRef = useRef(false)
  const rafRef = useRef(0)
  const dismissTimerRef = useRef(0)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  // Cleanup on unmount
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
    clearTimeout(dismissTimerRef.current)
  }, [])

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const el = scrollContainerRef.current
    if (!el || el.scrollTop > 0 || isRefreshingRef.current) return

    startYRef.current = e.touches[0].clientY
    trackingRef.current = true
    setIsPulling(true)
    setPastThreshold(false)
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
      setPastThreshold(false)
      return
    }

    const damped = applyDamping(deltaY, maxPull)
    if (damped > 0) {
      e.preventDefault()
    }
    pullDistanceRef.current = damped
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      setPullDistance(damped)
      setPastThreshold(damped >= threshold)
    })
  }, [maxPull, threshold])

  const finalizeDismiss = useCallback(() => {
    clearTimeout(dismissTimerRef.current)
    isRefreshingRef.current = false
    setIsRefreshing(false)
    setIsDismissing(false)
  }, [])

  // Only finalize on the height transition ending during dismiss phase
  const handleDismissEnd = useCallback((e: React.TransitionEvent) => {
    if (!isRefreshingRef.current) return
    if (e.propertyName !== 'height' || e.target !== e.currentTarget) return
    finalizeDismiss()
  }, [finalizeDismiss])

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
      setPastThreshold(false)
      try {
        await onRefreshRef.current()
      } catch (e) {
        console.error('[PullToRefresh] Refresh failed:', e)
      } finally {
        // Dismiss via CSS transitionend + fallback timeout
        setIsDismissing(true)
        // Safety: if transitionend doesn't fire (browser quirk), force cleanup
        dismissTimerRef.current = window.setTimeout(finalizeDismiss, 300)
      }
    } else {
      setPullDistance(0)
      setPastThreshold(false)
    }
  }, [threshold, finalizeDismiss])

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

  return {
    scrollContainerRef,
    pullDistance,
    isPulling,
    pastThreshold,
    isRefreshing,
    isDismissing,
    handleDismissEnd,
  }
}
