import { useEffect, useRef } from 'react'
import { AUTO_LOCK } from '@/core/constants'

/**
 * Auto-lock: blocks the UI and wipes in-memory secrets (the onLock callback runs
 * security.lock). serviceRegistry (sockets, subscriptions, sweep) stays alive — a PWA
 * has no OS push, so real-time receiving while the app is alive is the entire receive
 * experience, and killing the session on lock would resurrect a full reconnect burst
 * on every unlock.
 *
 * Trigger: a fixed idle timeout since the last user input, when enabled.
 * - The timer stalls during background freeze, so re-check the moment the screen
 *   becomes visible again to avoid exposing a long-idle screen unlocked.
 * - onWake (3s debounce + online condition) is deliberately not used: the lock check
 *   must fire immediately on return, even offline and without debounce.
 *
 * The session lives in memory only, so a full app kill always relocks regardless
 * of the enabled flag.
 */

const CHECK_INTERVAL_MS = 15_000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const

export function useAutoLock(params: {
  enabled: boolean
  isLocked: boolean
  onLock: () => void
}): void {
  const { enabled, isLocked, onLock } = params
  // Initial 0 is never used — the active effect always resets the start time (render purity)
  const lastActivityAtRef = useRef(0)
  const onLockRef = useRef(onLock)

  // Keep the latest callback in a ref so the watcher effect doesn't re-subscribe on every change
  useEffect(() => {
    onLockRef.current = onLock
  }, [onLock])

  useEffect(() => {
    if (isLocked || !enabled) return

    // Recompute from the unlock (or settings change) moment so leftover idle time
    // from the previous session doesn't trigger an immediate re-lock
    lastActivityAtRef.current = Date.now()
    const timeoutMs = AUTO_LOCK.TIMEOUT_MINUTES * 60_000

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
  }, [isLocked, enabled])
}
