import { describe, it, expect, beforeEach, vi } from 'vitest'
import { WalletCache, clearWalletCache } from '@/data/cache/wallet-cache'

// Mock cashu-ts v3 API
vi.mock('@cashu/cashu-ts', () => {
  // Mock Wallet class (cashu-ts v3 takes mintUrl directly)
  class MockWallet {
    mint: { mintUrl: string }

    constructor(mintUrl: string, _options?: { unit?: string }) {
      this.mint = { mintUrl }
    }

    loadMint = vi.fn().mockResolvedValue(undefined)
    getBalance = vi.fn().mockReturnValue(0)
  }

  return {
    Wallet: MockWallet,
  }
})

describe('WalletCache', () => {
  let cache: WalletCache

  beforeEach(() => {
    clearWalletCache()
    cache = new WalletCache()
  })

  describe('getWallet', () => {
    it('should create a new wallet for a mint URL', async () => {
      const wallet = await cache.getWallet('https://mint1.example.com')

      expect(wallet).toBeDefined()
      expect(wallet.mint.mintUrl).toBe('https://mint1.example.com')
    })

    it('should return cached wallet for same mint URL', async () => {
      const wallet1 = await cache.getWallet('https://mint1.example.com')
      const wallet2 = await cache.getWallet('https://mint1.example.com')

      expect(wallet1).toBe(wallet2)
    })

    it('should create different wallets for different mint URLs', async () => {
      const wallet1 = await cache.getWallet('https://mint1.example.com')
      const wallet2 = await cache.getWallet('https://mint2.example.com')

      expect(wallet1).not.toBe(wallet2)
    })

    it('should normalize mint URL (remove trailing slash)', async () => {
      const wallet1 = await cache.getWallet('https://mint.example.com/')
      const wallet2 = await cache.getWallet('https://mint.example.com')

      expect(wallet1).toBe(wallet2)
    })
  })

  describe('hasWallet', () => {
    it('should return false for non-cached mint', () => {
      const result = cache.hasWallet('https://mint.example.com')

      expect(result).toBe(false)
    })

    it('should return true for cached mint', async () => {
      await cache.getWallet('https://mint.example.com')

      const result = cache.hasWallet('https://mint.example.com')

      expect(result).toBe(true)
    })
  })

  describe('removeWallet', () => {
    it('should remove wallet from cache', async () => {
      await cache.getWallet('https://mint.example.com')

      cache.removeWallet('https://mint.example.com')

      expect(cache.hasWallet('https://mint.example.com')).toBe(false)
    })
  })

  describe('clear', () => {
    it('should clear all cached wallets', async () => {
      await cache.getWallet('https://mint1.example.com')
      await cache.getWallet('https://mint2.example.com')

      cache.clear()

      expect(cache.hasWallet('https://mint1.example.com')).toBe(false)
      expect(cache.hasWallet('https://mint2.example.com')).toBe(false)
    })
  })

  describe('getCachedMints', () => {
    it('should return empty array when no wallets cached', () => {
      const mints = cache.getCachedMints()

      expect(mints).toEqual([])
    })

    it('should return list of cached mint URLs', async () => {
      await cache.getWallet('https://mint1.example.com')
      await cache.getWallet('https://mint2.example.com')

      const mints = cache.getCachedMints()

      expect(mints).toHaveLength(2)
      expect(mints).toContain('https://mint1.example.com')
      expect(mints).toContain('https://mint2.example.com')
    })
  })
})
