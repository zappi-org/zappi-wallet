/**
 * Dev seed (`?seed=1`) contract — the entry point automation starts from.
 *
 * The mnemonic is a public test vector, so the seeded account holds no real value; the
 * point is only that a fresh profile reaches the app shell without driving onboarding.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  DEV_SEED_MNEMONIC,
  DEV_SEED_PIN,
  isDevSeedRequested,
  seedDevWallet,
} from '@/ui/lib/dev-seed'

describe('isDevSeedRequested', () => {
  it('detects the flag by presence, not value', () => {
    expect(isDevSeedRequested('?seed=1')).toBe(true)
    expect(isDevSeedRequested('?seed')).toBe(true)
    expect(isDevSeedRequested('?foo=1&seed=anything')).toBe(true)
  })

  it('ignores near misses', () => {
    expect(isDevSeedRequested('')).toBe(false)
    expect(isDevSeedRequested('?seeding=1')).toBe(false)
    expect(isDevSeedRequested('?seedx')).toBe(false)
  })
})

describe('seedDevWallet', () => {
  const makeSecurity = (has: boolean) => ({
    hasWallet: vi.fn(async () => has),
    createWallet: vi.fn(async () => ({ ok: true })),
  })

  it('creates the wallet with the fixed vector and PIN when none exists', async () => {
    const security = makeSecurity(false)

    await expect(seedDevWallet(security)).resolves.toBe(true)

    expect(security.createWallet).toHaveBeenCalledWith(DEV_SEED_MNEMONIC, DEV_SEED_PIN)
  })

  it('leaves an existing wallet alone — a seeded automation run must not overwrite state', async () => {
    const security = makeSecurity(true)

    await expect(seedDevWallet(security)).resolves.toBe(false)

    expect(security.createWallet).not.toHaveBeenCalled()
  })

  it('reports failure instead of throwing, so boot falls back to onboarding', async () => {
    const security = {
      hasWallet: vi.fn(async () => false),
      createWallet: vi.fn(async () => ({ ok: false })),
    }

    await expect(seedDevWallet(security)).resolves.toBe(false)
  })
})
