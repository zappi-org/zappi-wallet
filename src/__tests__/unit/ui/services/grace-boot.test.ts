/**
 * Boot-time grace decision. Pins the lockout-wins-over-resume invariant: an active
 * PIN lockout skips the resume AND drops the blob, so a force-quit-during-lockout
 * can't relaunch into a PIN-free resume.
 */
import { describe, it, expect, vi } from 'vitest'
import { resumeGraceOnBoot, type GraceBootDeps } from '@/ui/services/grace-boot'
import type { UnlockResult } from '@/core/ports/driving/security.usecase'

const RESUMED: UnlockResult = {
  keys: { publicKey: 'pub', privateKey: 'priv' },
  bip39Seed: new Uint8Array(64),
}

function makeDeps(over: Partial<GraceBootDeps> = {}): GraceBootDeps {
  return {
    isLockoutActive: vi.fn().mockReturnValue(false),
    tryResumeSession: vi.fn().mockResolvedValue(null),
    clearGrace: vi.fn().mockResolvedValue(undefined),
    applyUnlock: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

describe('resumeGraceOnBoot', () => {
  it('active lockout → clears grace and does NOT resume', async () => {
    const deps = makeDeps({ isLockoutActive: vi.fn().mockReturnValue(true) })
    await resumeGraceOnBoot(deps)

    expect(deps.clearGrace).toHaveBeenCalledTimes(1)
    expect(deps.tryResumeSession).not.toHaveBeenCalled()
    expect(deps.applyUnlock).not.toHaveBeenCalled()
  })

  it('no lockout + live blob → resumes via applyUnlock, no clear', async () => {
    const deps = makeDeps({ tryResumeSession: vi.fn().mockResolvedValue(RESUMED) })
    await resumeGraceOnBoot(deps)

    expect(deps.clearGrace).not.toHaveBeenCalled()
    expect(deps.tryResumeSession).toHaveBeenCalledTimes(1)
    expect(deps.applyUnlock).toHaveBeenCalledWith(RESUMED)
  })

  it('no lockout + no blob → falls through to PIN (no applyUnlock, no clear)', async () => {
    const deps = makeDeps()
    await resumeGraceOnBoot(deps)

    expect(deps.clearGrace).not.toHaveBeenCalled()
    expect(deps.tryResumeSession).toHaveBeenCalledTimes(1)
    expect(deps.applyUnlock).not.toHaveBeenCalled()
  })
})
