import { useEffect, useRef } from 'react'
import { AUTO_LOCK } from '@/core/constants'

/**
 * Auto-lock: after a fixed idle timeout, blocks the UI and wipes in-memory
 * secrets (onLock runs security.lock). serviceRegistry stays alive — a PWA has
 * no OS push, so killing sockets on lock would cost a reconnect burst per unlock.
 * Re-checks on visibility return because timers stall during background freeze.
 * The session is memory-only, so a full app kill always relocks regardless of
 * the enabled flag.
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
