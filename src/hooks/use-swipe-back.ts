import { useEffect, useRef } from 'react'

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
 */
export function useSwipeBack(onBack: () => void) {
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

  useEffect(() => {
    const state = stateRef.current

    function getSwipeTarget(): HTMLElement | null {
      const els = document.querySelectorAll('[data-swipe-target]')
      if (els.length > 0) return els[els.length - 1] as HTMLElement
      return null
    }

    /** Check if touch target is inside a horizontally scrollable element */
    function isInsideHorizontalScroller(el: EventTarget | null): boolean {
      let node = el as HTMLElement | null
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node)
        const overflowX = style.overflowX
        if (
          (overflowX === 'scroll' || overflowX === 'auto') &&
          node.scrollWidth > node.clientWidth
        ) {
          return true
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

      // Prevent browser scroll while swiping
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
        state.axis = 'none'
      } else if (state.target) {
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
        state.axis = 'none'
      } else {
        cleanup()
      }
    }

    // touchstart: passive (no preventDefault needed)
    // touchmove: non-passive to allow preventDefault when gesture is active
    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: false })
    window.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      cleanup()
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
    }
  }, [onBack])
}
