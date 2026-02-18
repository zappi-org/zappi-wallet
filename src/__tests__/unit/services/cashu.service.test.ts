import { describe, it, expect, beforeEach, vi } from 'vitest'
import { clearWalletCache } from '@/data/cache'

// Mock cashu-ts v3 API - all mocks must be defined inside factory due to hoisting
vi.mock('@cashu/cashu-ts', () => {
  const mockFn = vi.fn

  // Mock Wallet class (cashu-ts v3 takes mintUrl directly)
  class MockWallet {
    mint: { mintUrl: string }
    ops: {
      meltBolt11: ReturnType<typeof mockFn>
    }

    constructor(mintUrl: string, _options?: { unit?: string }) {
      this.mint = { mintUrl }
      this.ops = {
        meltBolt11: mockFn().mockReturnValue({
          run: mockFn().mockResolvedValue({
            quote: { state: 'PAID', payment_preimage: 'preimage' },
            change: [],
          }),
        }),
      }
    }

    loadMint = mockFn().mockResolvedValue(undefined)

    // Mint quote operations
    createMintQuote = mockFn().mockResolvedValue({
      quote: 'mock-quote-id',
      request: 'lnbc1000n1mock...',
      state: 'UNPAID',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    })

    checkMintQuote = mockFn().mockResolvedValue({
      quote: 'mock-quote-id',
      state: 'PAID',
    })

    mintProofs = mockFn().mockResolvedValue([
      { id: 'keyset1', amount: 64, secret: 'secret1', C: 'C1' },
      { id: 'keyset1', amount: 32, secret: 'secret2', C: 'C2' },
      { id: 'keyset1', amount: 4, secret: 'secret3', C: 'C3' },
    ])

    // Melt quote operations
    createMeltQuote = mockFn().mockResolvedValue({
      quote: 'mock-melt-quote-id',
      amount: 1000,
      fee_reserve: 10,
      state: 'UNPAID',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    })

    checkMeltQuoteBolt11 = mockFn().mockResolvedValue({
      quote: 'mock-melt-quote-id',
      state: 'PAID',
      amount: 1000,
      fee_reserve: 10,
    })

    receive = mockFn().mockResolvedValue([
      { id: 'keyset1', amount: 100, secret: 'new-secret', C: 'new-C' },
    ])

    send = mockFn().mockResolvedValue({
      keep: [{ id: 'keyset1', amount: 50, secret: 's1', C: 'c1' }],
      send: [{ id: 'keyset1', amount: 50, secret: 's2', C: 'c2' }],
    })
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

  describe('createMintQuote', () => {
    it('should create a mint quote', async () => {
      const result = await service.createMintQuote(mintUrl, 1000)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.quoteId).toBe('mock-quote-id')
        expect(result.value.request).toContain('lnbc')
      }
    })
  })

  describe('checkMintQuote', () => {
    it('should check mint quote status', async () => {
      const status = await service.checkMintQuote(mintUrl, 'mock-quote-id')

      expect(status).toBe('PAID')
    })
  })

  describe('redeemMintQuote', () => {
    it('should redeem a paid mint quote', async () => {
      const result = await service.redeemMintQuote(mintUrl, 'mock-quote-id', 100)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toHaveLength(3)
        expect(result.value[0].amount).toBe(64)
      }
    })
  })

  describe('createMeltQuote', () => {
    it('should create a melt quote', async () => {
      const result = await service.createMeltQuote(mintUrl, 'lnbc1000n1...')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.quoteId).toBe('mock-melt-quote-id')
        expect(result.value.amount).toBe(1000)
        expect(result.value.feeReserve).toBe(10)
      }
    })
  })

  describe('meltTokens', () => {
    it('should melt tokens', async () => {
      const proofs = [{ id: 'keyset1', amount: 100, secret: 's', C: 'c' }]
      const result = await service.meltTokens(mintUrl, 'mock-melt-quote-id', proofs)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.paid).toBe(true)
      }
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

  describe('createSendProofs', () => {
    it('should create proofs for sending', async () => {
      const proofs = [{ id: 'keyset1', amount: 100, secret: 's', C: 'c' }]
      const result = await service.createSendProofs(mintUrl, 50, proofs)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.send).toHaveLength(1)
        expect(result.value.keep).toHaveLength(1)
      }
    })
  })
})
