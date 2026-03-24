import { useRef, useState, useCallback, useEffect } from 'react'

// ─── State Machine ───

type PtrState = 'idle' | 'detecting' | 'pulling' | 'rejected' | 'refreshing' | 'completing'

// ─── Constants ───

/** Minimum movement (px) before deciding gesture direction */
const DEAD_ZONE = 10
/** Material Design standard easing */
const EASE_OUT = 'cubic-bezier(0.4, 0, 0.2, 1)'

// ─── Types ───

interface UsePullToRefreshOptions {
  /** Async callback to execute when refresh is triggered */
  onRefresh: () => Promise<void>
  /** Pull distance (px) required to trigger refresh (default 80) */
  threshold?: number
  /** Maximum pull distance — asymptotic limit (default 128) */
  maxPull?: number
}

interface UsePullToRefreshReturn {
  /** Attach to the scrollable container */
  scrollContainerRef: React.RefObject<HTMLElement | null>
  /** Attach to the PTR indicator wrapper — hook drives its style directly */
  indicatorRef: React.RefObject<HTMLDivElement | null>
  /** Attach to the arrow icon element inside the indicator */
  iconRef: React.RefObject<SVGSVGElement | null>
  /** true while the refresh promise is running (discrete state for conditional rendering) */
  isRefreshing: boolean
}

// ─── Damping ───

/** Exponential damping — asymptotically approaches maxPull. */
function applyDamping(rawDelta: number, maxPull: number): number {
  const k = 0.4
  return maxPull * (1 - Math.exp((-k * rawDelta) / maxPull))
}

// ─── Hook ───

export function usePullToRefresh({
  onRefresh,
  threshold = 80,
  maxPull = 128,
}: UsePullToRefreshOptions): UsePullToRefreshReturn {
  const scrollContainerRef = useRef<HTMLElement>(null)
  const indicatorRef = useRef<HTMLDivElement>(null)
  const iconRef = useRef<SVGSVGElement>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Mutable refs (no re-renders during drag)
  const stateRef = useRef<PtrState>('idle')
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const distanceRef = useRef(0)
  const rafRef = useRef(0)
  const onRefreshRef = useRef(onRefresh)
  onRefreshRef.current = onRefresh

  // Cleanup
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current)
  }, [])

  // ─── Direct DOM update (no React state) ───
  const applyIndicatorStyle = useCallback((distance: number, transition?: string) => {
    const el = indicatorRef.current
    if (!el) return
    el.style.transition = transition ?? ''
    el.style.height = `${distance}px`
    el.style.opacity = String(Math.min(distance / threshold, 1))

    const icon = iconRef.current
    if (icon) {
      icon.style.transform = distance >= threshold ? 'rotate(180deg)' : 'rotate(0deg)'
    }
  }, [threshold])

  const resetIndicator = useCallback((animated: boolean) => {
    distanceRef.current = 0
    if (animated) {
      applyIndicatorStyle(0, `height 200ms ${EASE_OUT}, opacity 200ms ${EASE_OUT}`)
    } else {
      applyIndicatorStyle(0)
    }
  }, [applyIndicatorStyle])

  // ─── Touch Handlers ───

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const el = scrollContainerRef.current
    if (!el || el.scrollTop > 0 || stateRef.current === 'refreshing' || stateRef.current === 'completing') return

    startXRef.current = e.touches[0].clientX
    startYRef.current = e.touches[0].clientY
    stateRef.current = 'detecting'
  }, [])

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const state = stateRef.current
    if (state === 'idle' || state === 'rejected' || state === 'refreshing' || state === 'completing') return

    const dx = e.touches[0].clientX - startXRef.current
    const dy = e.touches[0].clientY - startYRef.current

    if (state === 'detecting') {
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance < DEAD_ZONE) return

      if (Math.abs(dy) > Math.abs(dx) && dy > 0) {
        stateRef.current = 'pulling'
      } else {
        stateRef.current = 'rejected'
        return
      }
    }

    if (dy <= 0) {
      stateRef.current = 'rejected'
      cancelAnimationFrame(rafRef.current)
      resetIndicator(true)
      return
    }

    if (e.cancelable) {
      e.preventDefault()
    }

    const damped = applyDamping(dy, maxPull)
    distanceRef.current = damped

    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(() => {
      applyIndicatorStyle(damped)
    })
  }, [maxPull, applyIndicatorStyle, resetIndicator])

  const handleTouchEnd = useCallback(async () => {
    const state = stateRef.current
    if (state !== 'pulling' && state !== 'detecting') {
      if (state === 'rejected') stateRef.current = 'idle'
      return
    }

    cancelAnimationFrame(rafRef.current)
    const el = indicatorRef.current
    if (!el) {
      stateRef.current = 'idle'
      return
    }

    if (distanceRef.current >= threshold) {
      stateRef.current = 'refreshing'
      setIsRefreshing(true)

      // Snap to spinner resting height
      applyIndicatorStyle(48, `height 200ms ${EASE_OUT}, opacity 200ms ${EASE_OUT}`)

      try {
        await Promise.all([
          onRefreshRef.current(),
          new Promise((r) => setTimeout(r, 400)),
        ])
      } catch (e) {
        console.error('[PullToRefresh] Refresh failed:', e)
      } finally {
        stateRef.current = 'completing'
        resetIndicator(true)

        const onEnd = (ev: TransitionEvent) => {
          if (ev.propertyName !== 'height') return
          el.removeEventListener('transitionend', onEnd)
          stateRef.current = 'idle'
          setIsRefreshing(false)
        }
        el.addEventListener('transitionend', onEnd)

        // Safety fallback — also cleans up listener
        setTimeout(() => {
          if (stateRef.current === 'completing') {
            el.removeEventListener('transitionend', onEnd)
            stateRef.current = 'idle'
            setIsRefreshing(false)
          }
        }, 300)
      }
    } else {
      stateRef.current = 'idle'
      resetIndicator(true)
    }
  }, [threshold, applyIndicatorStyle, resetIndicator])

  const handleTouchCancel = useCallback(() => {
    if (stateRef.current === 'pulling' || stateRef.current === 'detecting') {
      cancelAnimationFrame(rafRef.current)
      stateRef.current = 'idle'
      resetIndicator(true)
    }
  }, [resetIndicator])

  // ─── Bind listeners ───

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    el.addEventListener('touchstart', handleTouchStart, { passive: true })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd)
    el.addEventListener('touchcancel', handleTouchCancel)

    return () => {
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
      el.removeEventListener('touchcancel', handleTouchCancel)
    }
  }, [handleTouchStart, handleTouchMove, handleTouchEnd, handleTouchCancel])

  return {
    scrollContainerRef,
    indicatorRef,
    iconRef,
    isRefreshing,
  }
}
