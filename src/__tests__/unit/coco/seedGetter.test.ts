import { describe, it, expect, beforeEach } from 'vitest'
import * as bip39 from '@scure/bip39'
import {
  getSeed,
  setCachedMnemonic,
  clearCachedMnemonic,
  isMnemonicCached,
} from '@/modules/cashu/internal/seed-getter'

// 테���트용 니모닉 (12 words)
const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('seedGetter', () => {
  beforeEach(() => {
    clearCachedMnemonic()
  })

  describe('getSeed', () => {
    it('should return BIP-39 standard seed when mnemonic is cached', async () => {
      setCachedMnemonic(TEST_MNEMONIC)

      const seed = await getSeed()
      const expected = bip39.mnemonicToSeedSync(TEST_MNEMONIC)

      expect(seed).toBeInstanceOf(Uint8Array)
      expect(seed.length).toBe(64)
      expect(seed).toEqual(expected)
    })

    it('should throw when no mnemonic is cached', async () => {
      await expect(getSeed()).rejects.toThrow(
        'Seed not available: wallet must be unlocked first',
      )
    })

    it('should return consistent seed for same mnemonic', async () => {
      setCachedMnemonic(TEST_MNEMONIC)

      const seed1 = await getSeed()
      const seed2 = await getSeed()

      expect(seed1).toEqual(seed2)
    })
  })

  describe('setCachedMnemonic / clearCachedMnemonic', () => {
    it('should make getSeed work after setting mnemonic', async () => {
      await expect(getSeed()).rejects.toThrow()

      setCachedMnemonic(TEST_MNEMONIC)

      const seed = await getSeed()
      expect(seed.length).toBe(64)
    })

    it('should make getSeed throw after clearing mnemonic', async () => {
      setCachedMnemonic(TEST_MNEMONIC)
      clearCachedMnemonic()

      await expect(getSeed()).rejects.toThrow(
        'Seed not available: wallet must be unlocked first',
      )
    })
  })

  describe('isMnemonicCached', () => {
    it('should return false when no mnemonic is cached', () => {
      expect(isMnemonicCached()).toBe(false)
    })

    it('should return true after setting mnemonic', () => {
      setCachedMnemonic(TEST_MNEMONIC)
      expect(isMnemonicCached()).toBe(true)
    })

    it('should return false after clearing mnemonic', () => {
      setCachedMnemonic(TEST_MNEMONIC)
      clearCachedMnemonic()
      expect(isMnemonicCached()).toBe(false)
    })
  })

  describe('unlock → getSeed → lock cycle', () => {
    it('should handle full lifecycle: set → get → clear → throw', async () => {
      // 1. Before unlock: no seed
      expect(isMnemonicCached()).toBe(false)
      await expect(getSeed()).rejects.toThrow()

      // 2. Unlock: cache mnemonic
      setCachedMnemonic(TEST_MNEMONIC)
      expect(isMnemonicCached()).toBe(true)

      // 3. Get seed: BIP-39 standard
      const seed = await getSeed()
      expect(seed.length).toBe(64)
      expect(seed).toEqual(bip39.mnemonicToSeedSync(TEST_MNEMONIC))

      // 4. Lock: clear cache
      clearCachedMnemonic()
      expect(isMnemonicCached()).toBe(false)
      await expect(getSeed()).rejects.toThrow()
    })
  })
})
