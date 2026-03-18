import { useEffect, useRef } from 'react'
import { useBackHandler } from '@/hooks/use-back-handler'

/** Minimum movement to decide axis lock direction */
const AXIS_LOCK_THRESHOLD = 10
/** If swipe covers > this fraction of screen width → commit */
const COMMIT_DISTANCE_RATIO = 0.35
/** If velocity exceeds this (px/s) → commit regardless of distance */
const COMMIT_VELOCITY = 500
/** Snap-back / commit animation duration (ms) */
const ANIMATION_DURATION = 280

type GestureAxis = 'none' | 'horizontal' | 'vertical'

/**
 * Discord/KakaoTalk-style swipe-back gesture.
 *
 * - Touch can start from anywhere on screen
 * - Axis-locked: first 10px of movement decides horizontal vs vertical
 * - Commits on velocity > 500 px/s OR distance > 35% screen width
 * - Cancels with spring snap-back otherwise
 * - Skips touches inside horizontally scrollable containers (carousels, etc.)
 * - Uses BackHandlerContext to dispatch back navigation
 *
 * All DOM mutations happen via refs — zero React re-renders during gestures.
 */
export function useSwipeBack() {
  const { goBack } = useBackHandler()

  // goBack is stable (useCallback with []), but ref guards against future changes
  const goBackRef = useRef(goBack)
  useEffect(() => { goBackRef.current = goBack }, [goBack])

  const stateRef = useRef({
    tracking: false,
    axis: 'none' as GestureAxis,
    startX: 0,
    startY: 0,
    startTime: 0,
    currentX: 0,
    overlay: null as HTMLDivElement | null,
    target: null as HTMLElement | null,
  })

  // Track pending timeouts for cleanup on unmount
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const state = stateRef.current

    function getSwipeTarget(): HTMLElement | null {
      const els = document.querySelectorAll('[data-swipe-target]')
      if (els.length > 0) return els[els.length - 1] as HTMLElement
      return null
    }

    function isInsideHorizontalScroller(el: EventTarget | null): boolean {
      const target = el as HTMLElement | null
      if (target?.closest?.('[data-horizontal-scroll]')) return true

      let node = target
      while (node && node !== document.body) {
        if (node.scrollWidth > node.clientWidth) {
          const overflowX = window.getComputedStyle(node).overflowX
          if (overflowX === 'scroll' || overflowX === 'auto') return true
        }
        node = node.parentElement
      }
      return false
    }

    function createOverlay(): HTMLDivElement {
      const overlay = document.createElement('div')
      overlay.style.cssText =
        'position:fixed;inset:0;background:black;opacity:0;z-index:9998;pointer-events:none;transition:none;'
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
      state.axis = 'none'
    }

    /** Shared animation-end logic for commit and snap-back */
    function animateEnd(
      targetTransform: string,
      easing: string,
      onDone?: () => void,
    ) {
      const target = state.target!
      const overlay = state.overlay

      target.style.transition = `transform ${ANIMATION_DURATION}ms ${easing}`
      target.style.transform = targetTransform
      if (overlay) {
        overlay.style.transition = `opacity ${ANIMATION_DURATION}ms ease-out`
        overlay.style.opacity = '0'
      }

      state.target = null
      state.overlay = null
      state.tracking = false
      state.axis = 'none'

      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null
        target.style.transition = ''
        target.style.transform = ''
        target.style.willChange = ''
        overlay?.remove()
        onDone?.()
      }, ANIMATION_DURATION)
    }

    function onTouchStart(e: TouchEvent) {
      if (isInsideHorizontalScroller(e.target)) return

      const touch = e.touches[0]
      state.tracking = true
      state.axis = 'none'
      state.startX = touch.clientX
      state.startY = touch.clientY
      state.startTime = Date.now()
      state.currentX = touch.clientX
    }

    function onTouchMove(e: TouchEvent) {
      if (!state.tracking) return

      const touch = e.touches[0]
      const dx = touch.clientX - state.startX
      const dy = touch.clientY - state.startY
      const absDx = Math.abs(dx)
      const absDy = Math.abs(dy)

      // Axis lock decision
      if (state.axis === 'none') {
        const totalMove = Math.sqrt(absDx * absDx + absDy * absDy)
        if (totalMove < AXIS_LOCK_THRESHOLD) return

        if (absDx > absDy * 1.2) {
          if (dx > 0) {
            state.axis = 'horizontal'
          } else {
            state.tracking = false
            return
          }
        } else {
          state.tracking = false
          return
        }
      }

      if (state.axis !== 'horizontal') return

      e.preventDefault()

      if (dx <= 0) {
        cleanup()
        return
      }

      state.currentX = touch.clientX

      // Acquire target on first recognized move
      if (!state.target) {
        state.target = getSwipeTarget()
        if (state.target) {
          state.target.style.willChange = 'transform'
          state.target.style.transition = 'none'
          state.overlay = createOverlay()
        }
      }

      // Apply transform directly to DOM (no React state updates in hot path)
      if (state.target) {
        state.target.style.transform = `translateX(${dx}px)`
        if (state.overlay) {
          const progress = Math.min(dx / window.innerWidth, 1)
          state.overlay.style.opacity = String(0.15 * (1 - progress))
        }
      }
    }

    function onTouchEnd() {
      if (!state.tracking || state.axis !== 'horizontal') {
        cleanup()
        return
      }

      const dx = state.currentX - state.startX
      const dt = Date.now() - state.startTime
      const velocity = dt > 0 ? (dx / dt) * 1000 : 0
      const ratio = dx / window.innerWidth

      const shouldCommit =
        state.target &&
        (velocity > COMMIT_VELOCITY || ratio > COMMIT_DISTANCE_RATIO)

      if (shouldCommit && state.target) {
        // Immediately clean up and trigger back — let AnimatePresence handle
        // the visual transition (avoids double-animation flash)
        cleanup()
        goBackRef.current()
      } else if (state.target) {
        animateEnd('translateX(0)', 'cubic-bezier(0.2, 0.9, 0.3, 1)')
      } else {
        cleanup()
      }
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', cleanup, { passive: true })

    return () => {
      cleanup()
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current)
        pendingTimerRef.current = null
      }
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', cleanup)
    }
  }, [])

}
