/**
 * Boot-time unlock-grace decision, extracted from MainApp so it is unit-testable
 * without a full app render.
 *
 * An active PIN lockout wins over any live grace blob: skip the resume AND drop the
 * blob, so a force-quit-during-lockout can't relaunch into a PIN-free resume that
 * bypasses the lockout. This is defense-in-depth beyond LockScreen's onLockout
 * (which may not have run, or may have raced, before the app was killed).
 */

import type { UnlockResult } from '@/core/ports/driving/security.usecase'

export interface GraceBootDeps {
  /** True when a PIN brute-force lockout is currently in effect. */
  isLockoutActive: () => boolean
  /** Load + hydrate a live grace session, or null (expired/absent/corrupt → PIN). */
  tryResumeSession: () => Promise<UnlockResult | null>
  /** Invalidate the grace blob. */
  clearGrace: () => Promise<void>
  /** Shared post-unlock wiring, applied to a resumed session. */
  applyUnlock: (result: UnlockResult) => Promise<void>
}

/**
 * Resume a still-valid grace session on boot, unless a lockout is active — in which
 * case clear the blob and stay on PIN. A null/expired blob simply falls through to
 * PIN. Callers wrap this so its own failure degrades to the PIN path.
 */
export async function resumeGraceOnBoot(deps: GraceBootDeps): Promise<void> {
  if (deps.isLockoutActive()) {
    await deps.clearGrace()
    return
  }
  const resumed = await deps.tryResumeSession()
  if (resumed) await deps.applyUnlock(resumed)
}
