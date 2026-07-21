import { useEffect, useRef } from 'react'

/**
 * Auto-lock: blocks the UI and wipes in-memory secrets (the onLock callback runs
 * security.lock). serviceRegistry (sockets, subscriptions, sweep) stays alive — a PWA
 * has no OS push, so real-time receiving while the app is alive is the entire receive
 * experience, and killing the session on lock would resurrect a full reconnect burst
 * on every unlock.
 *
 * Auto-lock is always on (no on/off toggle); the only knob is the idle timeout.
 *
 * Trigger: timeoutMinutes elapsed since the last user input.
 * - The timer stalls during background freeze, so re-check the moment the screen
 *   becomes visible again to avoid exposing a long-idle screen unlocked.
 * - onWake (3s debounce + online condition) is deliberately not used: the lock check
 *   must fire immediately on return, even offline and without debounce.
 *
 * Grace heartbeat (onExtendGrace): each check extends the grace expiry to
 * lastActivity + timeout, but only when activity advanced since the last extend —
 * a deterministic throttle (at most once per activity burst, no magic interval).
 * On a timeout change it re-clamps grace to now + the new timeout immediately, so a
 * shortened window takes effect without waiting for further activity.
 */

const CHECK_INTERVAL_MS = 15_000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const

export function useAutoLock(params: {
  timeoutMinutes: number
  isLocked: boolean
  onLock: () => void
  onExtendGrace?: (expiresAt: number) => void
}): void {
  const { timeoutMinutes, isLocked, onLock, onExtendGrace } = params
  // Initial 0 is never used — the active effect always resets the start time (render purity)
  const lastActivityAtRef = useRef(0)
  // The lastActivity value captured at the last grace extend (throttle baseline)
  const lastGraceExtendRef = useRef(0)
  const prevTimeoutRef = useRef(timeoutMinutes)
  const onLockRef = useRef(onLock)
  const onExtendGraceRef = useRef(onExtendGrace)

  // Keep the latest callbacks in refs so the watcher effect doesn't re-subscribe on every change
  useEffect(() => {
    onLockRef.current = onLock
  }, [onLock])
  useEffect(() => {
    onExtendGraceRef.current = onExtendGrace
  }, [onExtendGrace])

  useEffect(() => {
    if (isLocked || timeoutMinutes <= 0) return

    // Recompute from the unlock (or settings change) moment so leftover idle time
    // from the previous session doesn't trigger an immediate re-lock
    lastActivityAtRef.current = Date.now()
    lastGraceExtendRef.current = lastActivityAtRef.current
    const timeoutMs = timeoutMinutes * 60_000

    // Settings changed the timeout: re-clamp grace to now + new timeout immediately.
    // Skipped on the initial unlock (prevTimeout == timeout) since applyUnlock already
    // saved now + timeout. extend() is non-creating, so this never revives a cleared blob.
    if (prevTimeoutRef.current !== timeoutMinutes) {
      prevTimeoutRef.current = timeoutMinutes
      onExtendGraceRef.current?.(Date.now() + timeoutMs)
    }

    const markActivity = () => {
      lastActivityAtRef.current = Date.now()
    }
    const check = () => {
      if (Date.now() - lastActivityAtRef.current >= timeoutMs) {
        onLockRef.current()
        return
      }
      // Heartbeat — only when activity advanced since the last extend
      if (onExtendGraceRef.current && lastActivityAtRef.current > lastGraceExtendRef.current) {
        lastGraceExtendRef.current = lastActivityAtRef.current
        onExtendGraceRef.current(lastActivityAtRef.current + timeoutMs)
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }

    for (const ev of ACTIVITY_EVENTS) {
      window.addEventListener(ev, markActivity, { passive: true })
    }
    document.addEventListener('visibilitychange', onVisibility)
    const timer = setInterval(check, CHECK_INTERVAL_MS)

    return () => {
      for (const ev of ACTIVITY_EVENTS) {
        window.removeEventListener(ev, markActivity)
      }
      document.removeEventListener('visibilitychange', onVisibility)
      clearInterval(timer)
    }
  }, [isLocked, timeoutMinutes])
}
