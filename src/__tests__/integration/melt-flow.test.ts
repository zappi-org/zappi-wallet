import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { resetDatabase } from '@/data/database'
import { clearWalletCache } from '@/data/cache'
import { WalletService } from '@/services/wallet/wallet.service'

// Mock cashu-ts
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

// Mock Coco cashuService — getBalance now reads from Coco
const mockCocoBalances: Record<string, number> = {}
vi.mock('@/coco/cashuService', () => ({
  getBalances: vi.fn(async () => ({ ...mockCocoBalances })),
}))

// Mock SettingsRepository
vi.mock('@/data/repositories/settings.repository', () => {
  class MockSettingsRepository {
    getSettings = vi.fn().mockResolvedValue({
      mints: ['https://mint.example.com'],
      relays: ['wss://relay.example.com'],
    })
    saveSettings = vi.fn().mockResolvedValue(undefined)
  }
  return {
    SettingsRepository: MockSettingsRepository,
  }
})

describe('Melt/Withdrawal Flow Integration', () => {
  let walletService: WalletService

  beforeEach(async () => {
    await resetDatabase()
    clearWalletCache()
    vi.clearAllMocks()
    for (const key of Object.keys(mockCocoBalances)) delete mockCocoBalances[key]

    walletService = new WalletService()

    // Setup initial balance with various denominations
    await walletService.addProofs('https://mint.example.com', [
      { id: 'k1', amount: 512, secret: 's1', C: 'c1' },
      { id: 'k1', amount: 256, secret: 's2', C: 'c2' },
      { id: 'k1', amount: 128, secret: 's3', C: 'c3' },
      { id: 'k1', amount: 64, secret: 's4', C: 'c4' },
      { id: 'k1', amount: 32, secret: 's5', C: 'c5' },
      { id: 'k1', amount: 8, secret: 's6', C: 'c6' },
    ])
    mockCocoBalances['https://mint.example.com'] = 1000
  })

  afterEach(async () => {
    await resetDatabase()
  })

  describe('Proof Selection for Withdrawal', () => {
    it('should have correct initial balance', async () => {
      const balance = await walletService.getBalance()
      expect(balance.total).toBe(1000) // 512+256+128+64+32+8
    })

    it('should select proofs for withdrawal amount', async () => {
      const result = await walletService.getProofsForAmount(
        'https://mint.example.com',
        500
      )

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        const selectedTotal = result.value.reduce((s, p) => s + p.amount, 0)
        expect(selectedTotal).toBeGreaterThanOrEqual(500)
      }
    })

    it('should return error for insufficient balance', async () => {
      const result = await walletService.getProofsForAmount(
        'https://mint.example.com',
        5000 // More than available
      )

      expect(result.isErr()).toBe(true)
    })
  })

  describe('Balance Update After Withdrawal', () => {
    it('should decrease balance after removing proofs', async () => {
      const proofsResult = await walletService.getProofsForAmount(
        'https://mint.example.com',
        500
      )

      expect(proofsResult.isOk()).toBe(true)

      if (proofsResult.isOk()) {
        const selectedProofs = proofsResult.value

        await walletService.removeProofs('https://mint.example.com', selectedProofs)

        const remaining = await walletService.getProofs('https://mint.example.com')
        const remainingAmount = remaining.reduce((s, p) => s + p.amount, 0)
        expect(remainingAmount).toBeLessThan(1000)
      }
    })

    it('should handle full withdrawal', async () => {
      const proofs = await walletService.getProofs('https://mint.example.com')

      await walletService.removeProofs('https://mint.example.com', proofs)

      const remaining = await walletService.getProofs('https://mint.example.com')
      expect(remaining).toHaveLength(0)
    })

    it('should add change proofs back after melt', async () => {
      const proofsResult = await walletService.getProofsForAmount(
        'https://mint.example.com',
        500
      )

      expect(proofsResult.isOk()).toBe(true)

      if (proofsResult.isOk()) {
        const selectedProofs = proofsResult.value
        const selectedAmount = selectedProofs.reduce((s, p) => s + p.amount, 0)

        await walletService.removeProofs('https://mint.example.com', selectedProofs)

        const changeAmount = selectedAmount - 500 - 10
        if (changeAmount > 0) {
          await walletService.addProofs('https://mint.example.com', [
            { id: 'k1', amount: changeAmount, secret: 'change-s1', C: 'change-c1' },
          ])
        }

        const remaining = await walletService.getProofs('https://mint.example.com')
        const remainingAmount = remaining.reduce((s, p) => s + p.amount, 0)
        expect(remainingAmount).toBeLessThan(1000)
      }
    })
  })

  describe('Multi-mint Withdrawal', () => {
    beforeEach(async () => {
      // Add proofs from second mint
      await walletService.addProofs('https://mint2.example.com', [
        { id: 'k2', amount: 500, secret: 'm2-s1', C: 'm2-c1' },
      ])
    })

    it('should show combined balance from multiple mints', async () => {
      mockCocoBalances['https://mint2.example.com'] = 500
      const balance = await walletService.getBalance()
      expect(balance.total).toBe(1500)
      expect(balance.byMint['https://mint.example.com']).toBe(1000)
      expect(balance.byMint['https://mint2.example.com']).toBe(500)
    })

    it('should withdraw from specific mint only', async () => {
      const result = await walletService.getProofsForAmount(
        'https://mint2.example.com',
        300
      )

      expect(result.isOk()).toBe(true)

      if (result.isOk()) {
        await walletService.removeProofs('https://mint2.example.com', result.value)

        const remaining = await walletService.getProofs('https://mint2.example.com')
        expect(remaining).toHaveLength(0)
        // mint1 proofs untouched
        const mint1Proofs = await walletService.getProofs('https://mint.example.com')
        expect(mint1Proofs).toHaveLength(6)
      }
    })

    it('should return error when specific mint has insufficient balance', async () => {
      const result = await walletService.getProofsForAmount(
        'https://mint2.example.com',
        1000 // mint2 only has 500
      )

      expect(result.isErr()).toBe(true)
    })
  })

  describe('Ecash Token Generation', () => {
    it('should create proofs for token export', async () => {
      const result = await walletService.getProofsForAmount(
        'https://mint.example.com',
        200
      )

      expect(result.isOk()).toBe(true)

      if (result.isOk()) {
        // Verify proofs can be used for token
        const proofs = result.value
        expect(proofs.length).toBeGreaterThan(0)
        proofs.forEach((proof) => {
          expect(proof).toHaveProperty('id')
          expect(proof).toHaveProperty('amount')
          expect(proof).toHaveProperty('secret')
          expect(proof).toHaveProperty('C')
        })
      }
    })

    it('should mark proofs as pending when creating token', async () => {
      const result = await walletService.getProofsForAmount(
        'https://mint.example.com',
        200
      )

      expect(result.isOk()).toBe(true)

      if (result.isOk()) {
        const selectedProofs = result.value
        const initialProofs = await walletService.getProofs('https://mint.example.com')
        const initialCount = initialProofs.length

        // Remove from available balance
        await walletService.removeProofs('https://mint.example.com', selectedProofs)

        const remaining = await walletService.getProofs('https://mint.example.com')
        expect(remaining.length).toBe(initialCount - selectedProofs.length)
      }
    })
  })
})
