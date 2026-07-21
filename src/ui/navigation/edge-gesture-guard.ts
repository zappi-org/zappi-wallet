import { IS_IOS_LIKE } from './use-edge-swipe-back'

/**
 * Suppresses the iOS OS-level edge-swipe history gesture so the app owns both screen
 * edges. That gesture pre-animates a snapshot and then fires popstate, double-animating
 * on top of our own transitions; it also can't be disabled through any official API. We
 * neutralize it by preventDefault()ing edge touchstarts.
 *
 * Gate: only under a home-screen PWA (standalone display) on an iOS-like device. In a
 * plain Safari tab, hijacking the edge is hostile (the user expects the browser's own
 * back-swipe), so we leave it — the jump-cut layer handles the resulting double-animation.
 *
 * A preventDefaulted touchstart also cancels the native click iOS would synthesize, so a
 * short tap that lands in the suppressed edge zone (e.g. the top-left back button) would
 * go dead. We re-synthesize the click on touchend for taps that never became a drag; a
 * real drag exceeds the move tolerance and a long-press exceeds the duration, so neither
 * is misread as a tap. Only preventDefaulted touches are re-synthesized, so environments
 * where the native click still fires never get a double.
 */

const EDGE_ZONE_PX = 24
// A confirmed drag passes the custom gesture's direction lock (8px); anything under that
// is a stationary tap.
const TAP_MOVE_TOLERANCE_PX = 8
const TAP_MAX_DURATION_MS = 350

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const media = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false
  // iOS home-screen PWAs expose this legacy flag instead of the display-mode media query.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return media || iosStandalone
}

/** True when the OS edge-swipe must be suppressed (iOS-like AND installed PWA). */
export function isEdgeGuardActive(): boolean {
  return IS_IOS_LIKE && isStandaloneDisplay()
}

interface PendingTap {
  id: number
  x: number
  y: number
  t: number
}

export function installEdgeGestureGuard(): () => void {
  if (typeof window === 'undefined' || !isEdgeGuardActive()) return () => {}

  let pending: PendingTap | null = null

  const inEdgeZone = (x: number): boolean => x <= EDGE_ZONE_PX || x >= window.innerWidth - EDGE_ZONE_PX

  const onTouchStart = (e: TouchEvent): void => {
    // Single-finger only — a pinch that happens to start at the edge keeps native zoom.
    if (e.touches.length !== 1) {
      pending = null
      return
    }
    const touch = e.changedTouches[0]
    if (!touch || !inEdgeZone(touch.clientX)) {
      pending = null
      return
    }
    // Block the OS back/forward edge-swipe. The left edge is then driven by the custom
    // pointer gesture; the right edge only needs the OS forward-swipe suppressed.
    if (e.cancelable) e.preventDefault()
    pending = { id: touch.identifier, x: touch.clientX, y: touch.clientY, t: e.timeStamp }
  }

  const onTouchEnd = (e: TouchEvent): void => {
    const start = pending
    pending = null
    if (!start) return
    let touch: Touch | null = null
    for (const candidate of Array.from(e.changedTouches)) {
      if (candidate.identifier === start.id) {
        touch = candidate
        break
      }
    }
    if (!touch) return
    const moved = Math.hypot(touch.clientX - start.x, touch.clientY - start.y)
    const duration = e.timeStamp - start.t
    // Drags (moved past the lock) and long-presses (dwelled) are not taps.
    if (moved > TAP_MOVE_TOLERANCE_PX || duration > TAP_MAX_DURATION_MS) return
    // Re-fire the click the preventDefaulted touchstart swallowed. A bubbling event lets
    // it reach React's delegated root listener even when the hit target is an inner svg.
    const target = document.elementFromPoint(touch.clientX, touch.clientY)
    target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }))
  }

  const onTouchCancel = (): void => {
    pending = null
  }

  window.addEventListener('touchstart', onTouchStart, { passive: false, capture: true })
  window.addEventListener('touchend', onTouchEnd, { capture: true })
  window.addEventListener('touchcancel', onTouchCancel, { capture: true })

  return () => {
    window.removeEventListener('touchstart', onTouchStart, { capture: true })
    window.removeEventListener('touchend', onTouchEnd, { capture: true })
    window.removeEventListener('touchcancel', onTouchCancel, { capture: true })
  }
}
