import { useEffect, useRef } from 'react'
import { useBackHandler } from '@/hooks/use-back-handler'
import { swipeTransition } from '@/lib/swipe-transition'

/** Minimum movement to decide axis lock direction */
const AXIS_LOCK_THRESHOLD = 10
/** If swipe covers > this fraction of screen width → commit */
const COMMIT_DISTANCE_RATIO = 0.35
/** If velocity exceeds this (px/s) → commit regardless of distance */
const COMMIT_VELOCITY = 500
/** Slide-off / snap-back animation duration (ms) */
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
 * Targets `[data-swipe-target]` — a plain wrapper div in MainApp that wraps
 * AnimatePresence. This separates gesture transforms from motion/react's
 * internal animation system, preventing conflicts.
 *
 * All DOM mutations happen via refs — zero React re-renders during gestures.
 */
export function useSwipeBack() {
  const { goBack } = useBackHandler()

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
    prevScreen: null as HTMLElement | null,
  })

  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const state = stateRef.current

    function getSwipeTarget(): HTMLElement | null {
      return document.querySelector('[data-swipe-target]') as HTMLElement
    }

    function getPrevScreen(): HTMLElement | null {
      return document.querySelector('[data-prev-screen]') as HTMLElement
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
        'position:absolute;inset:0;background:black;opacity:0;z-index:5;pointer-events:none;transition:none;'
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
      if (state.prevScreen) {
        state.prevScreen.style.visibility = 'hidden'
        state.prevScreen = null
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

      e.preventDefault()

      if (dx <= 0) {
        cleanup()
        return
      }

      state.currentX = touch.clientX

      // Acquire target on first recognized horizontal move
      if (!state.target) {
        state.target = getSwipeTarget()
        if (state.target) {
          state.target.style.willChange = 'transform'
          state.target.style.transition = 'none'

          // Insert overlay as sibling before the wrapper (z-5, between prev layer z-0 and wrapper z-10)
          state.overlay = createOverlay()
          state.target.parentElement!.insertBefore(state.overlay, state.target)

          // Show previous screen layer
          state.prevScreen = getPrevScreen()
          if (state.prevScreen) {
            state.prevScreen.style.visibility = 'visible'
          }
        }
      }

      // Apply transform directly to wrapper (no React state updates in hot path)
      if (state.target) {
        state.target.style.transform = `translateX(${dx}px)`
        if (state.overlay) {
          const progress = Math.min(dx / window.innerWidth, 1)
          state.overlay.style.opacity = String(0.4 * (1 - progress))
        }
      }
    }

    /** Animate target to endX, then run callbacks: afterAnimation (sync) → afterPaint (rAF) */
    function animateEnd(
      endX: string,
      easing: string,
      afterAnimation?: () => void,
      afterPaint?: () => void,
    ) {
      const target = state.target!
      const overlay = state.overlay
      const prevScreen = state.prevScreen

      target.style.transition = `transform ${ANIMATION_DURATION}ms ${easing}`
      target.style.transform = `translateX(${endX})`
      if (overlay) {
        overlay.style.transition = `opacity ${ANIMATION_DURATION}ms ease-out`
        overlay.style.opacity = '0'
      }

      // Release state refs (DOM elements kept for the animation callback)
      state.target = null
      state.overlay = null
      state.prevScreen = null
      state.tracking = false
      state.axis = 'none'

      pendingTimerRef.current = setTimeout(() => {
        pendingTimerRef.current = null

        afterAnimation?.()

        // Reset DOM styles
        target.style.transition = 'none'
        target.style.transform = ''
        target.style.willChange = ''
        overlay?.remove()
        if (prevScreen) prevScreen.style.visibility = 'hidden'

        // Re-enable CSS transitions + run post-paint callback
        requestAnimationFrame(() => {
          target.style.transition = ''
          afterPaint?.()
        })
      }, ANIMATION_DURATION)
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
        animateEnd(
          `${window.innerWidth}px`,
          'cubic-bezier(0.2, 0, 0, 1)',
          () => { swipeTransition.mark(); goBackRef.current() },
          () => { swipeTransition.clear() },
        )
      } else if (state.target) {
        animateEnd('0', 'cubic-bezier(0.2, 0.9, 0.3, 1)')
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
