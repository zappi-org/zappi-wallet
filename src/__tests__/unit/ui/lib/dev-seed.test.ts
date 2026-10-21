/** `?seed=1` contract: flag parsing, never overwrite an existing wallet, fail soft. */
import { describe, it, expect, vi } from 'vitest'
import {
  DEV_SEED_MNEMONIC,
  DEV_SEED_PIN,
  readInjectedSeed,
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

const storageWith = (value: string | null) => ({ getItem: vi.fn(() => value) })

describe('readInjectedSeed', () => {
  it('accepts a script-injected phrase of 12+ words', () => {
    const injected = 'legal winner thank year wave sausage worth useful legal winner thank yellow'
    expect(readInjectedSeed(storageWith(injected))).toBe(injected)
  })

  it('rejects absent, blank, and short values (a typo must not become a wallet)', () => {
    for (const value of [null, '', '   ', 'abandon abandon about']) {
      expect(readInjectedSeed(storageWith(value))).toBeNull()
    }
  })
})

describe('seedDevWallet', () => {
  const makeSecurity = (has: boolean) => ({
    hasWallet: vi.fn(async () => has),
    // Mirror the real Result<UnlockResult, SecurityError> shape, not just the field the
    // implementation happens to read today — a `value` access later must not break silently.
    createWallet: vi.fn(async () => ({ ok: true, value: { keys: {}, bip39Seed: new Uint8Array() } })),
  })

  it('creates the wallet with the built-in vector and PIN when nothing is injected', async () => {
    const security = makeSecurity(false)

    await expect(seedDevWallet(security, storageWith(null))).resolves.toBe(true)

    expect(security.createWallet).toHaveBeenCalledWith(DEV_SEED_MNEMONIC, DEV_SEED_PIN)
  })

  it('lets a script-injected phrase override the built-in vector', async () => {
    const security = makeSecurity(false)
    const injected = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

    await expect(seedDevWallet(security, storageWith(injected))).resolves.toBe(true)

    expect(security.createWallet).toHaveBeenCalledWith(injected, DEV_SEED_PIN)
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
