import { describe, it, expect, beforeEach } from 'vitest'
import {
  setCachedMnemonic,
  clearCachedMnemonic,
  isMnemonicCached,
  getSeed,
  injectSeedCache,
} from './seed-getter'
import type { SeedCache } from '@/core/ports/driven/seed-cache.port'

function createMockSeedCache(): SeedCache {
  let mnemonic: string | null = null
  return {
    cacheMnemonic: (m: string) => { mnemonic = m },
    getCachedMnemonic: () => mnemonic,
    isCached: () => mnemonic !== null,
    clearCache: () => { mnemonic = null },
  }
}

describe('seed-getter', () => {
  beforeEach(() => {
    const cache = createMockSeedCache()
    injectSeedCache(cache)
    clearCachedMnemonic()
  })

  it('should not be cached initially', () => {
    expect(isMnemonicCached()).toBe(false)
  })

  it('should cache mnemonic', () => {
    setCachedMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
    expect(isMnemonicCached()).toBe(true)
  })

  it('should clear cached mnemonic', () => {
    setCachedMnemonic('test mnemonic')
    clearCachedMnemonic()
    expect(isMnemonicCached()).toBe(false)
  })

  it('should throw when getSeed called without cache', async () => {
    await expect(getSeed()).rejects.toThrow('Seed not available')
  })

  it('should return BIP-39 seed when mnemonic cached', async () => {
    setCachedMnemonic('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
    const seed = await getSeed()
    expect(seed).toBeInstanceOf(Uint8Array)
    expect(seed.length).toBe(64)
  })

  it('should throw when SeedCache not injected', () => {
    injectSeedCache(null as unknown as SeedCache)
    expect(() => setCachedMnemonic('test')).toThrow()
  })
})
