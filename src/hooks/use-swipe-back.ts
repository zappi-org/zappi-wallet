import { useEffect, useRef } from 'react'

/** Edge zone width in px — touch must start within this distance from left edge */
const EDGE_ZONE = 24
/** Minimum movement to begin tracking (distinguish from tap) */
const RECOGNITION_THRESHOLD = 10
/** If swipe covers > this fraction of screen width → commit */
const COMMIT_DISTANCE_RATIO = 0.4
/** If velocity exceeds this (px/s) → commit regardless of distance */
const COMMIT_VELOCITY = 400
/** Max vertical drift before gesture is cancelled (prevents diagonal conflict) */
const MAX_VERTICAL_DRIFT = 80
/** Snap-back / commit animation duration (ms) */
const ANIMATION_DURATION = 280

/**
 * iOS-style interactive swipe-back gesture.
 *
 * - Touch must start within EDGE_ZONE px of left edge
 * - Current page translates in real-time with finger
 * - Commits on velocity > 400 px/s OR distance > 40% screen width
 * - Cancels with spring snap-back otherwise
 */
export function useSwipeBack(onBack: () => void) {
  const stateRef = useRef({
    tracking: false,
    recognized: false,
    startX: 0,
    startY: 0,
    startTime: 0,
    currentX: 0,
    overlay: null as HTMLDivElement | null,
    target: null as HTMLElement | null,
  })

  useEffect(() => {
    const state = stateRef.current

    function getSwipeTarget(): HTMLElement | null {
      // Get the last (topmost/current) PageTransition element
      const els = document.querySelectorAll('[data-swipe-target]')
      if (els.length > 0) return els[els.length - 1] as HTMLElement
      return null
    }

    function createOverlay(): HTMLDivElement {
      const overlay = document.createElement('div')
      overlay.style.cssText = 'position:fixed;inset:0;background:black;opacity:0;z-index:9998;pointer-events:none;transition:none;'
      document.body.appendChild(overlay)
      return overlay
    }

    function cleanup() {
      if (state.overlay) {
        state.overlay.remove()
        state.overlay = null
      }
      if (state.target) {
        state.target.style.transition = ''
        state.target.style.transform = ''
        state.target.style.willChange = ''
        state.target = null
      }
      state.tracking = false
      state.recognized = false
    }

    function onTouchStart(e: TouchEvent) {
      const touch = e.touches[0]
      if (touch.clientX > EDGE_ZONE) return

      state.tracking = true
      state.recognized = false
      state.startX = touch.clientX
      state.startY = touch.clientY
      state.startTime = Date.now()
      state.currentX = touch.clientX
    }

    function onTouchMove(e: TouchEvent) {
      if (!state.tracking) return

      const touch = e.touches[0]
      const dx = touch.clientX - state.startX
      const dy = Math.abs(touch.clientY - state.startY)

      // Too much vertical movement → cancel
      if (dy > MAX_VERTICAL_DRIFT) {
        cleanup()
        return
      }

      // Only rightward swipe
      if (dx < 0) {
        cleanup()
        return
      }

      state.currentX = touch.clientX

      // Begin recognized gesture after threshold
      if (!state.recognized && dx >= RECOGNITION_THRESHOLD) {
        state.recognized = true
        state.target = getSwipeTarget()
        if (state.target) {
          state.target.style.willChange = 'transform'
          state.target.style.transition = 'none'
          state.overlay = createOverlay()
        }
      }

      if (state.recognized && state.target) {
        const translateX = dx
        state.target.style.transform = `translateX(${translateX}px)`
        // Fade overlay from 0 to 0.15 max
        if (state.overlay) {
          const progress = Math.min(dx / window.innerWidth, 1)
          state.overlay.style.opacity = String(0.15 * (1 - progress))
        }
      }
    }

    function onTouchEnd() {
      if (!state.tracking) return

      const dx = state.currentX - state.startX
      const dt = Date.now() - state.startTime
      const velocity = dt > 0 ? (dx / dt) * 1000 : 0
      const ratio = dx / window.innerWidth

      const shouldCommit =
        state.recognized &&
        (velocity > COMMIT_VELOCITY || ratio > COMMIT_DISTANCE_RATIO)

      if (shouldCommit && state.target) {
        // Animate off-screen then trigger back
        state.target.style.transition = `transform ${ANIMATION_DURATION}ms cubic-bezier(0.2, 0, 0, 1)`
        state.target.style.transform = `translateX(${window.innerWidth}px)`
        if (state.overlay) {
          state.overlay.style.transition = `opacity ${ANIMATION_DURATION}ms ease-out`
          state.overlay.style.opacity = '0'
        }
        const target = state.target
        const overlay = state.overlay
        setTimeout(() => {
          target.style.transition = ''
          target.style.transform = ''
          target.style.willChange = ''
          overlay?.remove()
          onBack()
        }, ANIMATION_DURATION)
        state.target = null
        state.overlay = null
        state.tracking = false
        state.recognized = false
      } else if (state.recognized && state.target) {
        // Snap back
        state.target.style.transition = `transform ${ANIMATION_DURATION}ms cubic-bezier(0.2, 0.9, 0.3, 1)`
        state.target.style.transform = 'translateX(0)'
        if (state.overlay) {
          state.overlay.style.transition = `opacity ${ANIMATION_DURATION}ms ease-out`
          state.overlay.style.opacity = '0'
        }
        const target = state.target
        const overlay = state.overlay
        setTimeout(() => {
          target.style.transition = ''
          target.style.willChange = ''
          overlay?.remove()
        }, ANIMATION_DURATION)
        state.target = null
        state.overlay = null
        state.tracking = false
        state.recognized = false
      } else {
        cleanup()
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      cleanup()
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [onBack])
}
