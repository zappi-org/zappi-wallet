import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { animate, motionValue, useReducedMotion, type MotionValue } from 'motion/react'
import { getNavigationSnapshot } from './navigation-store'

// iOS-like touch devices only. Android is excluded on purpose: its system
// predictive-back gesture owns the same left screen edge, so a JS edge-swipe there
// would fight and double-trigger the navigation.
function detectIOSLike(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports a desktop-Safari UA but is a multi-touch device.
  return /iP(hone|ad|od)/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}

export const IS_IOS_LIKE = detectIOSLike()

const EDGE_HIT_ZONE_PX = 24
const DIRECTION_LOCK_PX = 8
const COMMIT_DISTANCE_RATIO = 0.35
const COMMIT_VELOCITY_PX_S = 500
const COMMIT_DURATION_S = 0.18
const COMMIT_EASE: [number, number, number, number] = [0.32, 0.72, 0, 1]
const SETTLE_STIFFNESS = 520
const SETTLE_DAMPING = 46

export const PARALLAX_RATIO = 0.24
export const SCRIM_MAX_OPACITY = 0.28

// One shared 0->1 progress value (0 at rest, 1 = the top screen swiped fully away).
// The drag writes it directly and the release settle animates it, so a hand-released
// gesture and its programmatic finish are one continuous value (no jump on release).
// Both participating screens — the top and the one beneath — derive their transforms
// from it. Module scope because only one gesture is ever in flight.
export const swipeProgress: MotionValue<number> = motionValue(0)

export interface SwipePhase {
  active: boolean
  // Kept bound to the value after a commit so the popped screen's own exit transition
  // is a no-op — it unmounts frozen off-screen instead of replaying a second slide.
  committed: boolean
  subjectId: string | null
  belowId: string | null
}

const IDLE_PHASE: SwipePhase = { active: false, committed: false, subjectId: null, belowId: null }
let currentPhase: SwipePhase = IDLE_PHASE
const phaseListeners = new Set<() => void>()

function setPhase(next: SwipePhase): void {
  currentPhase = next
  phaseListeners.forEach((listener) => listener())
}
function subscribePhase(listener: () => void): () => void {
  phaseListeners.add(listener)
  return () => phaseListeners.delete(listener)
}
function getPhase(): SwipePhase {
  return currentPhase
}

/** Sibling activities read this to learn whether they are the drag subject/underlay. */
export function useSwipePhase(): SwipePhase {
  return useSyncExternalStore(subscribePhase, getPhase, getPhase)
}

export interface EdgeSwipeBinding {
  bind: {
    onPointerDown: (e: ReactPointerEvent) => void
    onPointerMove: (e: ReactPointerEvent) => void
    onPointerUp: (e: ReactPointerEvent) => void
    onPointerCancel: (e: ReactPointerEvent) => void
  } | null
  // pan-y lets the browser keep vertical scrolling while delivering horizontal pans to
  // our handlers, so we never have to fight native scroll.
  touchAction: 'pan-y' | undefined
}

interface DragState {
  armed: boolean
  active: boolean
  pointerId: number
  startX: number
  startY: number
  width: number
  lastX: number
  lastT: number
  velocity: number
}

export function useEdgeSwipeBack(params: {
  isTop: boolean
  activityId: string
  belowActivityId: string | null
  onCommit: () => void
}): EdgeSwipeBinding {
  const { isTop, activityId, belowActivityId, onCommit } = params
  const reduceMotion = useReducedMotion()

  const state = useRef<DragState>({
    armed: false,
    active: false,
    pointerId: -1,
    startX: 0,
    startY: 0,
    width: 1,
    lastX: 0,
    lastT: 0,
    velocity: 0,
  })

  // Refs so the handlers can stay stable (bound once) yet read current values. Synced
  // in an effect — never during render — and only read at pointer-event time, which
  // always runs after the commit that updated them.
  const commitRef = useRef(onCommit)
  const belowRef = useRef(belowActivityId)
  const activityIdRef = useRef(activityId)
  const reduceRef = useRef(reduceMotion)
  useEffect(() => {
    commitRef.current = onCommit
    belowRef.current = belowActivityId
    activityIdRef.current = activityId
    reduceRef.current = reduceMotion
  })

  const handlers = useMemo(() => {
    const settle = (target: 0 | 1, onDone: () => void): void => {
      // Reduced motion: user drives the drag, but the settle just snaps (duration 0).
      if (reduceRef.current) {
        animate(swipeProgress, target, { duration: 0, onComplete: onDone })
        return
      }
      if (target === 1) {
        animate(swipeProgress, target, { duration: COMMIT_DURATION_S, ease: COMMIT_EASE, onComplete: onDone })
        return
      }
      animate(swipeProgress, target, {
        type: 'spring',
        stiffness: SETTLE_STIFFNESS,
        damping: SETTLE_DAMPING,
        onComplete: onDone,
      })
    }

    const finish = (allowCommit: boolean): void => {
      const s = state.current
      s.armed = false
      if (!s.active) return
      s.active = false
      const dx = swipeProgress.get() * s.width
      const commit =
        allowCommit && (dx > s.width * COMMIT_DISTANCE_RATIO || s.velocity > COMMIT_VELOCITY_PX_S)
      if (commit) {
        settle(1, () => {
          commitRef.current()
          // Freeze the popped screen at 100% (off-screen) through its exit so stackflow's
          // own slide-out is a visual no-op; it then unmounts where it already sits.
          setPhase({ active: false, committed: true, subjectId: activityIdRef.current, belowId: null })
        })
      } else {
        settle(0, () => {
          setPhase(IDLE_PHASE)
          swipeProgress.set(0)
        })
      }
    }

    return {
      onPointerDown(e: ReactPointerEvent) {
        if (!e.isPrimary) return
        if (e.clientX > EDGE_HIT_ZONE_PX) return
        const snap = getNavigationSnapshot()
        if (snap.stack.length <= 1) return
        // Only a clean single-level pop to the screen directly beneath: the parallax
        // reveals that mounted screen, so an off-stack/multi-level back would lie.
        if (snap.previousScreen !== snap.stack[snap.stack.length - 2]) return
        if (belowRef.current === null) return
        const s = state.current
        s.armed = true
        s.active = false
        s.pointerId = e.pointerId
        s.startX = e.clientX
        s.startY = e.clientY
        s.width = window.innerWidth || 1
        s.lastX = e.clientX
        s.lastT = e.timeStamp
        s.velocity = 0
        // No capture / preventDefault yet — a stationary tap on an edge button must still
        // click; we only claim the pointer once a horizontal drag is confirmed.
      },
      onPointerMove(e: ReactPointerEvent) {
        const s = state.current
        if (e.pointerId !== s.pointerId) return
        if (!s.armed && !s.active) return
        const dx = e.clientX - s.startX
        const dy = e.clientY - s.startY
        if (!s.active) {
          if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return
          // Direction lock: vertical or leftward intent yields to native scrolling.
          if (Math.abs(dy) >= Math.abs(dx) || dx <= 0) {
            s.armed = false
            return
          }
          s.active = true
          s.armed = false
          // Capture so moves that leave the element still reach us. Guarded: a stale/
          // synthetic pointer id throws InvalidStateError, which must not abort the drag.
          try {
            ;(e.currentTarget as Element).setPointerCapture?.(s.pointerId)
          } catch {
            // no active pointer for this id — proceed without capture
          }
          // Seed before binding: after a prior commit the value is left at 1, and a new
          // subject binding to a stale 1 would flash off-screen for a frame.
          swipeProgress.set(Math.min(1, Math.max(0, dx) / s.width))
          setPhase({ active: true, committed: false, subjectId: activityIdRef.current, belowId: belowRef.current })
          s.lastX = e.clientX
          s.lastT = e.timeStamp
          return
        }
        const now = e.timeStamp
        const dt = now - s.lastT
        if (dt > 0) s.velocity = ((e.clientX - s.lastX) / dt) * 1000
        s.lastX = e.clientX
        s.lastT = now
        swipeProgress.set(Math.min(1, Math.max(0, dx) / s.width))
      },
      onPointerUp() {
        finish(true)
      },
      onPointerCancel() {
        finish(false)
      },
    }
  }, [])

  const eligible = IS_IOS_LIKE && isTop && belowActivityId !== null
  return {
    bind: eligible ? handlers : null,
    touchAction: eligible ? 'pan-y' : undefined,
  }
}
