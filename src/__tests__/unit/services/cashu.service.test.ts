import { describe, it, expect, beforeEach, vi } from 'vitest'
import { clearWalletCache } from '@/data/cache'

// Mock cashu-ts v3 API - all mocks must be defined inside factory due to hoisting
vi.mock('@cashu/cashu-ts', () => {
  const mockFn = vi.fn

  // Mock Wallet class (cashu-ts v3 takes mintUrl directly)
  class MockWallet {
    mint: { mintUrl: string }

    constructor(mintUrl: string, _options?: { unit?: string }) {
      this.mint = { mintUrl }
    }

    loadMint = mockFn().mockResolvedValue(undefined)

    checkMintQuote = mockFn().mockResolvedValue({
      quote: 'mock-quote-id',
      state: 'PAID',
    })

    receive = mockFn().mockResolvedValue([
      { id: 'keyset1', amount: 100, secret: 'new-secret', C: 'new-C' },
    ])
  }

  return {
    Wallet: MockWallet,
    getEncodedToken: mockFn().mockReturnValue('cashuBmocktoken...'),
    getDecodedToken: mockFn().mockReturnValue({
      mint: 'https://mint.example.com',
      proofs: [{ id: 'keyset1', amount: 100, secret: 's', C: 'c' }],
      unit: 'sat',
    }),
  }
})

import { CashuService } from '@/services/cashu/cashu.service'

describe('CashuService', () => {
  let service: CashuService
  const mintUrl = 'https://mint.example.com'

  beforeEach(() => {
    clearWalletCache()
    service = new CashuService()
  })

  describe('getWallet', () => {
    it('should return a wallet for the given mint URL', async () => {
      const wallet = await service.getWallet(mintUrl)

      expect(wallet).toBeDefined()
      expect(wallet.mint.mintUrl).toBe(mintUrl)
    })

    it('should cache wallets', async () => {
      const wallet1 = await service.getWallet(mintUrl)
      const wallet2 = await service.getWallet(mintUrl)

      expect(wallet1).toBe(wallet2)
    })
  })

  describe('checkMintQuote', () => {
    it('should check mint quote status', async () => {
      const status = await service.checkMintQuote(mintUrl, 'mock-quote-id')

      expect(status).toBe('PAID')
    })
  })

  describe('receiveToken', () => {
    it('should receive a token', async () => {
      const result = await service.receiveToken('cashuBmocktoken...')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.proofs).toHaveLength(1)
        expect(result.value.proofs[0].amount).toBe(100)
      }
    })
  })

  describe('encodeToken', () => {
    it('should encode proofs to token string', () => {
      const proofs = [{ id: 'keyset1', amount: 100, secret: 's', C: 'c' }]
      const token = service.encodeToken(mintUrl, proofs)

      expect(token).toContain('cashuB')
    })
  })

  describe('decodeToken', () => {
    it('should decode a token string', () => {
      const decoded = service.decodeToken('cashuBmocktoken...')

      expect(decoded.mintUrl).toBe('https://mint.example.com')
      expect(decoded.proofs).toHaveLength(1)
    })
  })
})
