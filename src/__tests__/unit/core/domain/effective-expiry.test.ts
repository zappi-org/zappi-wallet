import { describe, it, expect, vi } from 'vitest'
import { checkEffectiveExpiry } from '@/core/domain/effective-expiry'

describe('checkEffectiveExpiry', () => {
  it('expires immediately when local expiry has passed', async () => {
    const probe = { checkAlive: vi.fn().mockResolvedValue(true) }

    await expect(checkEffectiveExpiry({ expiresAt: 1_000 }, [probe], 1_000)).resolves.toBe('expired')
    expect(probe.checkAlive).not.toHaveBeenCalled()
  })

  it('stays alive when no counterparty probes exist and local expiry is in the future', async () => {
    await expect(checkEffectiveExpiry({ expiresAt: 2_000 }, [], 1_000)).resolves.toBe('alive')
  })

  it('expires when every live-check-capable counterparty reports dead', async () => {
    await expect(checkEffectiveExpiry(
      { expiresAt: 2_000 },
      [{ checkAlive: vi.fn().mockResolvedValue(false) }],
      1_000,
    )).resolves.toBe('expired')
  })

  it('stays alive when at least one counterparty still reports alive', async () => {
    await expect(checkEffectiveExpiry(
      { expiresAt: 2_000 },
      [
        { checkAlive: vi.fn().mockResolvedValue(false) },
        { checkAlive: vi.fn().mockResolvedValue(true) },
      ],
      1_000,
    )).resolves.toBe('alive')
  })

  it('ignores probes that cannot determine liveness', async () => {
    await expect(checkEffectiveExpiry(
      { expiresAt: 2_000 },
      [{ checkAlive: vi.fn().mockResolvedValue(undefined) }],
      1_000,
    )).resolves.toBe('alive')
  })
})
