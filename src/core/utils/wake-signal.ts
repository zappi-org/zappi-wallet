/**
 * onWake — single debounce point for foreground-return / network-recovery signals.
 *
 * Merges `online` and `visibilitychange(visible)` into one trailing debounce (default 3s).
 * On mobile, foreground transitions and network flapping fire these two events back to
 * back; without debouncing, each would run its own health-check/refresh and cause double
 * churn on relays and mints.
 */

export interface WakeSignalOptions {
  /** Trailing debounce — runs once this long after the last trigger. Default 3s. */
  debounceMs?: number
}

const DEFAULT_DEBOUNCE_MS = 3_000

export function onWake(callback: () => void, options: WakeSignalOptions = {}): () => void {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS
  let timer: ReturnType<typeof setTimeout> | null = null

  const trigger = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      callback()
    }, debounceMs)
  }

  const handleOnline = () => trigger()
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') trigger()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility)
  }

  return () => {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', handleOnline)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }
}
