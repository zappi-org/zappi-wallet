import { useEffect, useRef } from 'react'

/**
 * Auto-lock: blocks the UI and wipes in-memory secrets (the onLock callback runs
 * security.lock). serviceRegistry (sockets, subscriptions, sweep) stays alive — a PWA
 * has no OS push, so real-time receiving while the app is alive is the entire receive
 * experience, and killing the session on lock would resurrect a full reconnect burst
 * on every unlock.
 *
 * Trigger: timeoutMinutes elapsed since the last user input.
 * - The timer stalls during background freeze, so re-check the moment the screen
 *   becomes visible again to avoid exposing a long-idle screen unlocked.
 * - onWake (3s debounce + online condition) is deliberately not used: the lock check
 *   must fire immediately on return, even offline and without debounce.
 */

const CHECK_INTERVAL_MS = 15_000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const

export function useAutoLock(params: {
  enabled: boolean
  timeoutMinutes: number
  isLocked: boolean
  onLock: () => void
}): void {
  const { enabled, timeoutMinutes, isLocked, onLock } = params
  // Initial 0 is never used — the active effect always resets the start time (render purity)
  const lastActivityAtRef = useRef(0)
  const onLockRef = useRef(onLock)

  // Keep the latest callback in a ref so the watcher effect doesn't re-subscribe on every onLock change
  useEffect(() => {
    onLockRef.current = onLock
  }, [onLock])

  useEffect(() => {
    if (!enabled || isLocked || timeoutMinutes <= 0) return

    // Recompute from the unlock (or settings change) moment so leftover idle time
    // from the previous session doesn't trigger an immediate re-lock
    lastActivityAtRef.current = Date.now()
    const timeoutMs = timeoutMinutes * 60_000

    const markActivity = () => {
      lastActivityAtRef.current = Date.now()
    }
    const check = () => {
      if (Date.now() - lastActivityAtRef.current >= timeoutMs) {
        onLockRef.current()
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
  }, [enabled, isLocked, timeoutMinutes])
}
