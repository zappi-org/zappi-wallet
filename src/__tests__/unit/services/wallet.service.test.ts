import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { WalletService } from '@/services/wallet/wallet.service'
import { resetDatabase } from '@/data/database'
import { clearWalletCache } from '@/data/cache'

// Mock cashu-ts (required for wallet-cache import)
vi.mock('@cashu/cashu-ts', () => {
  class MockCashuMint {
    mintUrl: string
    constructor(mintUrl: string) {
      this.mintUrl = mintUrl
    }
  }
  class MockCashuWallet {
    mint: MockCashuMint
    constructor(mint: MockCashuMint) {
      this.mint = mint
    }
    loadMint = vi.fn().mockResolvedValue(undefined)
  }
  return {
    CashuWallet: MockCashuWallet,
    CashuMint: MockCashuMint,
  }
})

// Mock CashuService
vi.mock('@/services/cashu/cashu.service', () => ({
  CashuService: vi.fn().mockImplementation(() => ({
    getWallet: vi.fn().mockResolvedValue({
      mint: { mintUrl: 'https://mint.example.com' },
    }),
    receiveToken: vi.fn().mockResolvedValue({
      isOk: () => true,
      value: {
        proofs: [{ id: 'k1', amount: 100, secret: 's1', C: 'c1' }],
        mintUrl: 'https://mint.example.com',
      },
    }),
    decodeToken: vi.fn().mockReturnValue({
      mintUrl: 'https://mint.example.com',
      proofs: [{ amount: 100 }],
    }),
    getTotalAmount: vi.fn().mockImplementation((proofs) =>
      proofs.reduce((sum: number, p: { amount: number }) => sum + p.amount, 0)
    ),
  })),
}))

// Mock SettingsRepository
vi.mock('@/data/repositories/settings.repository', () => {
  class MockSettingsRepository {
    getSettings = vi.fn().mockResolvedValue({
      mints: ['https://mint1.com', 'https://mint2.com'],
      relays: ['wss://relay1.com'],
    })
    saveSettings = vi.fn().mockResolvedValue(undefined)
  }
  return {
    SettingsRepository: MockSettingsRepository,
  }
})

describe('WalletService', () => {
  let service: WalletService

  beforeEach(async () => {
    await resetDatabase()
    clearWalletCache()
    service = new WalletService()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  describe('getBalance', () => {
    it('should return total balance from all mints', async () => {
      // Add some proofs first via transaction
      await service.addProofs('https://mint1.com', [
        { id: 'k1', amount: 100, secret: 's1', C: 'c1' },
        { id: 'k1', amount: 50, secret: 's2', C: 'c2' },
      ])
      await service.addProofs('https://mint2.com', [
        { id: 'k2', amount: 200, secret: 's3', C: 'c3' },
      ])

      const balance = await service.getBalance()

      expect(balance.total).toBe(350)
      expect(balance.byMint['https://mint1.com']).toBe(150)
      expect(balance.byMint['https://mint2.com']).toBe(200)
    })

    it('should return 0 when no proofs', async () => {
      const balance = await service.getBalance()

      expect(balance.total).toBe(0)
    })
  })

  describe('getBalanceByMint', () => {
    it('should return balance for specific mint', async () => {
      await service.addProofs('https://mint1.com', [
        { id: 'k1', amount: 100, secret: 's1', C: 'c1' },
      ])

      const balance = await service.getBalanceByMint('https://mint1.com')

      expect(balance).toBe(100)
    })

    it('should return 0 for mint with no proofs', async () => {
      const balance = await service.getBalanceByMint('https://nonexistent.com')

      expect(balance).toBe(0)
    })
  })

  describe('addProofs', () => {
    it('should add proofs and update balance', async () => {
      await service.addProofs('https://mint.com', [
        { id: 'k1', amount: 100, secret: 's1', C: 'c1' },
      ])

      const balance = await service.getBalanceByMint('https://mint.com')
      expect(balance).toBe(100)
    })
  })

  describe('getProofs', () => {
    it('should return proofs for a mint', async () => {
      await service.addProofs('https://mint.com', [
        { id: 'k1', amount: 100, secret: 's1', C: 'c1' },
        { id: 'k1', amount: 50, secret: 's2', C: 'c2' },
      ])

      const proofs = await service.getProofs('https://mint.com')

      expect(proofs).toHaveLength(2)
    })
  })

  describe('getProofsForAmount', () => {
    it('should select proofs for exact amount', async () => {
      await service.addProofs('https://mint.com', [
        { id: 'k1', amount: 64, secret: 's1', C: 'c1' },
        { id: 'k1', amount: 32, secret: 's2', C: 'c2' },
        { id: 'k1', amount: 4, secret: 's3', C: 'c3' },
      ])

      const result = await service.getProofsForAmount('https://mint.com', 100)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        const total = result.value.reduce((s, p) => s + p.amount, 0)
        expect(total).toBeGreaterThanOrEqual(100)
      }
    })

    it('should return error for insufficient balance', async () => {
      await service.addProofs('https://mint.com', [
        { id: 'k1', amount: 50, secret: 's1', C: 'c1' },
      ])

      const result = await service.getProofsForAmount('https://mint.com', 100)

      expect(result.isErr()).toBe(true)
    })
  })

  describe('removeProofs', () => {
    it('should remove specific proofs', async () => {
      await service.addProofs('https://mint.com', [
        { id: 'k1', amount: 100, secret: 's1', C: 'c1' },
        { id: 'k1', amount: 50, secret: 's2', C: 'c2' },
      ])

      await service.removeProofs('https://mint.com', [
        { id: 'k1', amount: 100, secret: 's1', C: 'c1' },
      ])

      const balance = await service.getBalanceByMint('https://mint.com')
      expect(balance).toBe(50)
    })
  })

  describe('getMints', () => {
    it('should return configured mints', async () => {
      const mints = await service.getMints()

      expect(mints).toContain('https://mint1.com')
      expect(mints).toContain('https://mint2.com')
    })
  })
})
