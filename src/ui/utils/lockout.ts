/**
 * PIN brute-force lockout marker — the single source of truth for reading the
 * lockout state LockScreen persists in localStorage. Both LockScreen and the boot
 * resume path parse it through here so the two can never diverge on the shape.
 */

const LOCKOUT_KEY = 'lockout'

export interface LockoutMarker {
  /** ms epoch until which entry is blocked. */
  until: number
  /** Failed-attempt count captured when the lockout was recorded. */
  attempts: number
}

/** Parse the persisted lockout marker, or null when absent/corrupt. */
export function readLockoutMarker(): LockoutMarker | null {
  try {
    const raw = localStorage.getItem(LOCKOUT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LockoutMarker>
    if (typeof parsed?.until !== 'number' || typeof parsed?.attempts !== 'number') return null
    return { until: parsed.until, attempts: parsed.attempts }
  } catch {
    return null
  }
}

/** Whether a lockout is currently in effect (marker present and not yet expired). */
export function isLockoutActive(now: number = Date.now()): boolean {
  const marker = readLockoutMarker()
  return marker !== null && marker.until > now
}
