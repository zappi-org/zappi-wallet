import { getNavigationSnapshot } from './navigation-store'

/**
 * Prevents the iOS OS-level edge-swipe from exiting the document at the stack ROOT.
 * A standalone PWA resting on Home has no in-app back target, so the OS back-swipe
 * navigates to the launch document entry — a full app reload that lands the user on
 * the lock screen. We neutralize it by preventDefault()ing left-edge touchstarts,
 * but ONLY at the root: pushed screens keep the native OS gesture (absorbed by the
 * jump-cut transition layer), so their left edge stays fully native.
 *
 * Only the LEFT edge is claimed: forward-history is rare enough that killing right-edge
 * scroll (nested horizontal scrollers, the right 24px of any page) to suppress it isn't worth
 * it, so the right edge is left entirely to the browser/page.
 *
 * Gate: only under a home-screen PWA (standalone display) on an iOS-like device — in a plain
 * Safari tab, hijacking the edge is hostile (the user expects the browser's own back-swipe) —
 * AND only at the stack root (depth <= 1). Accepted cost: the left 24px on Home no longer
 * starts a touch interaction natively (including the leftmost strip of the card carousel);
 * taps there are re-synthesized below, and edge-origin scrolls/drags are sacrificed to keep
 * the app alive.
 *
 * A preventDefaulted touchstart also cancels the native click iOS would synthesize, so a short
 * tap in the suppressed edge zone would go dead. We re-synthesize the click on touchend for
 * taps that never became a drag; a real drag exceeds the move tolerance and a long-press
 * exceeds the duration, so neither is misread as a tap. Synthesis is armed only when
 * preventDefault() actually applied (a cancelable touchstart we cancelled), so environments
 * where the native click still fires never get a double.
 */

// iOS-like touch devices only. Android is excluded on purpose: its system
// predictive-back gesture is handled by the browser/OS differently, and a JS
// edge guard there would fight the platform's own back affordance.
function detectIOSLike(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports a desktop-Safari UA but is a multi-touch device.
  return /iP(hone|ad|od)/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

const IS_IOS_LIKE = detectIOSLike()

const EDGE_ZONE_PX = 24
// Anything moving past this is a drag, not a stationary tap.
const TAP_MOVE_TOLERANCE_PX = 8
const TAP_MAX_DURATION_MS = 350
// Focusable elements a synthesized tap should also focus, to approximate a real tap.
const FOCUSABLE_SELECTOR = 'input, textarea, select, button, [tabindex]'

function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const media = window.matchMedia?.('(display-mode: standalone)')?.matches ?? false
  // iOS home-screen PWAs expose this legacy flag instead of the display-mode media query.
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return media || iosStandalone
}

/** True when the root exit-guard must install (iOS-like AND installed PWA). */
export function isEdgeGuardActive(): boolean {
  return IS_IOS_LIKE && isStandaloneDisplay()
}

interface PendingTap {
  id: number
  x: number
  y: number
  t: number
  // Peak displacement across the whole touch, tracked on touchmove. Final displacement
  // alone would miss an out-and-back flick that ends within tolerance of the start point
  // yet was clearly a drag, not a tap.
  maxDelta: number
  // The element under the finger at touchstart — synthesis is skipped if the release lands
  // on an unrelated element (an overlay that appeared mid-tap).
  target: Element | null
}

// Same element, or one is an ancestor/descendant of the other (svg icon inside a button,
// a wrapper resolved by elementFromPoint) — a release within this lineage is the same tap.
function sharesLineage(a: Element, b: Element): boolean {
  return a === b || a.contains(b) || b.contains(a)
}

export function installEdgeGestureGuard(): () => void {
  if (typeof window === 'undefined' || !isEdgeGuardActive()) return () => {}

  let pending: PendingTap | null = null

  // Left edge only — the OS back-swipe exit lives there; the right edge stays with the page.
  const inLeftEdgeZone = (x: number): boolean => x <= EDGE_ZONE_PX

  const onTouchStart = (e: TouchEvent): void => {
    pending = null
    // Single-finger only — a pinch that happens to start at the edge keeps native zoom.
    if (e.touches.length !== 1) return
    const touch = e.changedTouches[0]
    if (!touch || !inLeftEdgeZone(touch.clientX)) return
    // Root only: with a back target on the stack the OS gesture pops in-app (the jump-cut
    // layer absorbs its animation), so pushed screens keep the fully native edge.
    if (getNavigationSnapshot().stack.length > 1) return
    // Arm synthesis only when we can actually cancel the OS gesture. A non-cancelable
    // touchstart still fires its native click, so re-synthesizing would double the tap.
    if (!e.cancelable) return
    e.preventDefault()
    pending = {
      id: touch.identifier,
      x: touch.clientX,
      y: touch.clientY,
      t: e.timeStamp,
      maxDelta: 0,
      target: document.elementFromPoint(touch.clientX, touch.clientY),
    }
  }

  const onTouchMove = (e: TouchEvent): void => {
    const start = pending
    if (!start) return
    for (const candidate of Array.from(e.changedTouches)) {
      if (candidate.identifier === start.id) {
        const delta = Math.hypot(candidate.clientX - start.x, candidate.clientY - start.y)
        if (delta > start.maxDelta) start.maxDelta = delta
        break
      }
    }
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
    // Peak displacement, not just final: an out-and-back drag must not read as a tap.
    const moved = Math.max(start.maxDelta, Math.hypot(touch.clientX - start.x, touch.clientY - start.y))
    const duration = e.timeStamp - start.t
    // Drags (moved past the tolerance) and long-presses (dwelled) are not taps.
    if (moved > TAP_MOVE_TOLERANCE_PX || duration > TAP_MAX_DURATION_MS) return
    const target = document.elementFromPoint(touch.clientX, touch.clientY)
    if (!target) return
    // Overlay-retarget guard: a sheet/toast that appeared during the tap could sit under the
    // release point without being what the user pressed. Only synthesize when the release
    // still lands within the element captured at touchstart.
    if (start.target && !sharesLineage(start.target, target)) return
    // A real tap on a disabled control does nothing — don't synthesize a click for it either.
    if (target.closest(':disabled')) return
    // Re-fire the click the preventDefaulted touchstart swallowed. A bubbling event lets it
    // reach React's delegated root listener even when the hit target is an inner svg.
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    // Approximate a real tap's focus transfer so keyboard/IME behaviour matches (an input
    // gains focus, a button becomes the active element).
    const focusable = target.closest(FOCUSABLE_SELECTOR)
    if (focusable instanceof HTMLElement) focusable.focus()
  }

  const onTouchCancel = (): void => {
    pending = null
  }

  window.addEventListener('touchstart', onTouchStart, { passive: false, capture: true })
  window.addEventListener('touchmove', onTouchMove, { passive: true, capture: true })
  window.addEventListener('touchend', onTouchEnd, { capture: true })
  window.addEventListener('touchcancel', onTouchCancel, { capture: true })

  return () => {
    window.removeEventListener('touchstart', onTouchStart, { capture: true })
    window.removeEventListener('touchmove', onTouchMove, { capture: true })
    window.removeEventListener('touchend', onTouchEnd, { capture: true })
    window.removeEventListener('touchcancel', onTouchCancel, { capture: true })
  }
}
