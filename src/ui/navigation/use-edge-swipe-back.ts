import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import {
  animate,
  motionValue,
  useReducedMotion,
  type AnimationPlaybackControls,
  type MotionValue,
} from 'motion/react'
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
// Release velocity comes from the moves inside this trailing window, so a pause
// before lifting decays it to ~0 instead of replaying a stale flick.
const VELOCITY_WINDOW_MS = 100

export const PARALLAX_RATIO = 0.24
export const SCRIM_MAX_OPACITY = 0.28

// One shared 0->1 progress value (0 at rest, 1 = the top screen swiped fully away).
// The drag writes it directly and the release settle animates it, so a hand-released
// gesture and its programmatic finish are one continuous value (no jump on release).
// Both participating screens — the top and the one beneath — derive their transforms
// from it. Module scope because only one gesture is ever in flight.
export const swipeProgress: MotionValue<number> = motionValue(0)

// Single module-scope gesture owner: at most one activity ever drives swipeProgress.
// armed = edge pointerdown seen, direction lock not yet decided; active = the drag
// owns the pointer; settling = finger up, spring/commit animation in flight;
// committed = the pop was dispatched and the popped screen sits frozen off-screen
// until it unmounts. New gestures are accepted only from idle.
type GestureState = 'idle' | 'armed' | 'active' | 'settling' | 'committed'

let gestureState: GestureState = 'idle'
let gestureOwnerId: string | null = null
// Bumped on every ownership change so async animation completions can detect they
// are stale and no-op instead of mutating a newer gesture's state.
let gestureGeneration = 0
let activeControls: AnimationPlaybackControls | null = null

function stopActiveControls(): void {
  activeControls?.stop()
  activeControls = null
}

// Native scroll is suppressed only after the direction lock hands the pointer to the
// drag: a non-passive capture-phase touchmove listener preventDefault()s (iOS Safari
// honors it on non-passive listeners) and is removed when the drag finishes. Nothing
// is claimed before the lock, so edge taps, nested horizontal scrollers and
// pinch-zoom all keep their native behavior.
let touchMoveSuppressor: ((e: TouchEvent) => void) | null = null

function installTouchMoveSuppressor(): void {
  if (touchMoveSuppressor || typeof window === 'undefined') return
  touchMoveSuppressor = (e: TouchEvent) => {
    // Once the browser has started a native scroll the event is non-cancelable.
    if (e.cancelable) e.preventDefault()
  }
  window.addEventListener('touchmove', touchMoveSuppressor, { passive: false, capture: true })
}

function removeTouchMoveSuppressor(): void {
  if (!touchMoveSuppressor || typeof window === 'undefined') return
  window.removeEventListener('touchmove', touchMoveSuppressor, { capture: true })
  touchMoveSuppressor = null
}

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

/**
 * Drops the gesture if the given activity owns it (eligibility loss or unmount).
 * The post-commit freeze must survive eligibility loss — the popped screen stays
 * parked off-screen through its exit transition — so it is only cleared when the
 * unmounting activity itself asks (includeCommitted).
 */
function releaseGesture(activityId: string, opts: { includeCommitted: boolean }): void {
  if (gestureOwnerId !== activityId || gestureState === 'idle') return
  if (gestureState === 'committed' && !opts.includeCommitted) return
  gestureGeneration += 1
  stopActiveControls()
  removeTouchMoveSuppressor()
  gestureState = 'idle'
  gestureOwnerId = null
  setPhase(IDLE_PHASE)
  swipeProgress.set(0)
}

export interface EdgeSwipeBinding {
  bind: {
    onPointerDown: (e: ReactPointerEvent) => void
    onPointerMove: (e: ReactPointerEvent) => void
    onPointerUp: (e: ReactPointerEvent) => void
    onPointerCancel: (e: ReactPointerEvent) => void
    onLostPointerCapture: (e: ReactPointerEvent) => void
  } | null
}

interface VelocitySample {
  x: number
  t: number
}

interface DragState {
  pointerId: number
  startX: number
  startY: number
  width: number
  // The underlay identity at drag start; a commit is only honored while it still holds.
  belowIdAtStart: string | null
  samples: VelocitySample[]
}

export function useEdgeSwipeBack(params: {
  isTop: boolean
  isTransitioning: boolean
  activityId: string
  belowActivityId: string | null
  onCommit: () => void
}): EdgeSwipeBinding {
  const { isTop, isTransitioning, activityId, belowActivityId, onCommit } = params
  const reduceMotion = useReducedMotion()

  const state = useRef<DragState>({
    pointerId: -1,
    startX: 0,
    startY: 0,
    width: 1,
    belowIdAtStart: null,
    samples: [],
  })

  // Refs so the handlers can stay stable (bound once) yet read current values. Synced
  // in an effect — never during render — and only read at pointer-event time, which
  // always runs after the commit that updated them.
  const commitRef = useRef(onCommit)
  const belowRef = useRef(belowActivityId)
  const activityIdRef = useRef(activityId)
  const reduceRef = useRef(reduceMotion)
  const isTopRef = useRef(isTop)
  const transitioningRef = useRef(isTransitioning)
  useEffect(() => {
    commitRef.current = onCommit
    belowRef.current = belowActivityId
    activityIdRef.current = activityId
    reduceRef.current = reduceMotion
    isTopRef.current = isTop
    transitioningRef.current = isTransitioning
  })

  const handlers = useMemo(() => {
    const settle = (target: 0 | 1, onDone: () => void): void => {
      const generation = gestureGeneration
      const onComplete = (): void => {
        // A newer gesture (or a release) took over while this animation ran.
        if (generation !== gestureGeneration) return
        activeControls = null
        onDone()
      }
      stopActiveControls()
      // Reduced motion: user drives the drag, but the settle just snaps (duration 0).
      if (reduceRef.current) {
        activeControls = animate(swipeProgress, target, { duration: 0, onComplete })
        return
      }
      if (target === 1) {
        activeControls = animate(swipeProgress, target, {
          duration: COMMIT_DURATION_S,
          ease: COMMIT_EASE,
          onComplete,
        })
        return
      }
      activeControls = animate(swipeProgress, target, {
        type: 'spring',
        stiffness: SETTLE_STIFFNESS,
        damping: SETTLE_DAMPING,
        onComplete,
      })
    }

    const pushSample = (x: number, t: number): void => {
      const samples = state.current.samples
      samples.push({ x, t })
      // Timestamps are monotonic, so pruning the stale prefix keeps exactly the window.
      while (samples.length > 0 && samples[0].t < t - VELOCITY_WINDOW_MS) samples.shift()
    }

    const releaseVelocity = (x: number, t: number): number => {
      pushSample(x, t)
      const samples = state.current.samples
      if (samples.length < 2) return 0
      const first = samples[0]
      const last = samples[samples.length - 1]
      const dt = last.t - first.t
      return dt > 0 ? ((last.x - first.x) / dt) * 1000 : 0
    }

    // A commit navigates to what the parallax showed at drag start; if the stack moved
    // under the gesture (a push/replace landed mid-drag), that promise is broken and
    // the release must spring back instead.
    const targetStillValid = (): boolean => {
      if (!isTopRef.current) return false
      if (belowRef.current === null || belowRef.current !== state.current.belowIdAtStart) return false
      const snap = getNavigationSnapshot()
      if (snap.stack.length <= 1) return false
      return snap.previousScreen === snap.stack[snap.stack.length - 2]
    }

    const settleBack = (): void => {
      gestureState = 'settling'
      settle(0, () => {
        gestureState = 'idle'
        gestureOwnerId = null
        setPhase(IDLE_PHASE)
        swipeProgress.set(0)
      })
    }

    const finish = (allowCommit: boolean, velocity: number): void => {
      if (gestureOwnerId !== activityIdRef.current) return
      if (gestureState === 'armed') {
        // Never activated: nothing visual to unwind.
        gestureState = 'idle'
        gestureOwnerId = null
        return
      }
      if (gestureState !== 'active') return
      removeTouchMoveSuppressor()
      const s = state.current
      const dx = swipeProgress.get() * s.width
      const shouldCommit =
        allowCommit &&
        (dx > s.width * COMMIT_DISTANCE_RATIO || velocity > COMMIT_VELOCITY_PX_S) &&
        targetStillValid()
      if (!shouldCommit) {
        settleBack()
        return
      }
      gestureState = 'settling'
      settle(1, () => {
        // Re-check at the last instant: a push can also land during the settle itself.
        if (!targetStillValid()) {
          settleBack()
          return
        }
        let committed = false
        try {
          commitRef.current()
          committed = true
        } finally {
          if (committed) {
            // Freeze the popped screen at 100% (off-screen) through its exit so
            // stackflow's own slide-out is a visual no-op; the unmount cleanup resets
            // the shared state once the screen is gone.
            gestureState = 'committed'
            setPhase({
              active: false,
              committed: true,
              subjectId: activityIdRef.current,
              belowId: null,
            })
          } else {
            // The commit threw: bring the subject back instead of stranding it off-screen.
            settleBack()
          }
        }
      })
    }

    return {
      onPointerDown(e: ReactPointerEvent) {
        // Only the primary pointer can arm; extra fingers never join or steal a gesture.
        if (!e.isPrimary) return
        if (gestureState !== 'idle') return
        // Wait for the activity to settle (enter-done): grabbing a screen that is
        // still animating in would fight the push transition over the same transform.
        if (transitioningRef.current) return
        if (e.clientX > EDGE_HIT_ZONE_PX) return
        const snap = getNavigationSnapshot()
        if (snap.stack.length <= 1) return
        // Only a clean single-level pop to the screen directly beneath: the parallax
        // reveals that mounted screen, so an off-stack/multi-level back would lie.
        if (snap.previousScreen !== snap.stack[snap.stack.length - 2]) return
        if (belowRef.current === null) return
        gestureGeneration += 1
        stopActiveControls()
        gestureState = 'armed'
        gestureOwnerId = activityIdRef.current
        const s = state.current
        s.pointerId = e.pointerId
        s.startX = e.clientX
        s.startY = e.clientY
        s.width = window.innerWidth || 1
        s.belowIdAtStart = belowRef.current
        s.samples = []
        pushSample(e.clientX, e.timeStamp)
        // No capture / preventDefault yet — a stationary tap on an edge button must
        // still click; we only claim the pointer once a horizontal drag is confirmed.
      },
      onPointerMove(e: ReactPointerEvent) {
        const s = state.current
        if (e.pointerId !== s.pointerId) return
        if (gestureOwnerId !== activityIdRef.current) return
        if (gestureState !== 'armed' && gestureState !== 'active') return
        const dx = e.clientX - s.startX
        const dy = e.clientY - s.startY
        if (gestureState === 'armed') {
          if (Math.abs(dx) < DIRECTION_LOCK_PX && Math.abs(dy) < DIRECTION_LOCK_PX) return
          // Direction lock: vertical or leftward intent yields to native scrolling.
          if (Math.abs(dy) >= Math.abs(dx) || dx <= 0) {
            gestureState = 'idle'
            gestureOwnerId = null
            return
          }
          gestureState = 'active'
          // Claim the pointer: capture keeps moves that leave the element, and the
          // non-passive suppressor stops native scroll for the rest of the drag.
          // Guarded: a stale/synthetic pointer id throws InvalidStateError, which
          // must not abort the drag.
          try {
            ;(e.currentTarget as Element).setPointerCapture?.(s.pointerId)
          } catch {
            // no active pointer for this id — proceed without capture
          }
          installTouchMoveSuppressor()
          // Seed before binding: after a prior commit the value is left at 1, and a
          // new subject binding to a stale 1 would flash off-screen for a frame.
          swipeProgress.set(Math.min(1, Math.max(0, dx) / s.width))
          setPhase({
            active: true,
            committed: false,
            subjectId: activityIdRef.current,
            belowId: s.belowIdAtStart,
          })
          pushSample(e.clientX, e.timeStamp)
          return
        }
        pushSample(e.clientX, e.timeStamp)
        swipeProgress.set(Math.min(1, Math.max(0, dx) / s.width))
      },
      onPointerUp(e: ReactPointerEvent) {
        if (e.pointerId !== state.current.pointerId) return
        if (gestureOwnerId !== activityIdRef.current) return
        finish(true, releaseVelocity(e.clientX, e.timeStamp))
      },
      onPointerCancel(e: ReactPointerEvent) {
        if (e.pointerId !== state.current.pointerId) return
        if (gestureOwnerId !== activityIdRef.current) return
        finish(false, 0)
      },
      onLostPointerCapture(e: ReactPointerEvent) {
        // Capture can be torn away without a pointerup (browser/system takeover);
        // spring back rather than leaving a stranded half-dragged screen. After a
        // normal pointerup this fires too, but the state is already 'settling'.
        if (e.pointerId !== state.current.pointerId) return
        if (gestureOwnerId !== activityIdRef.current) return
        if (gestureState === 'active') finish(false, 0)
      },
    }
  }, [])

  const eligible = IS_IOS_LIKE && isTop && belowActivityId !== null

  // Losing eligibility mid-gesture (a push made this screen non-top) cancels the
  // drag/settle outright; the post-commit freeze is left for the unmount cleanup.
  useEffect(() => {
    if (!eligible) releaseGesture(activityId, { includeCommitted: false })
  }, [eligible, activityId])

  // Unmount clears everything this activity owns, including the post-commit
  // swipeProgress=1 freeze once the popped screen is finally gone.
  useEffect(() => {
    return () => releaseGesture(activityId, { includeCommitted: true })
  }, [activityId])

  return {
    bind: eligible ? handlers : null,
  }
}
