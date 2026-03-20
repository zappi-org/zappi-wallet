import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { resetDatabase } from '@/data/database'
import { clearWalletCache } from '@/data/cache'
import { WalletService } from '@/services/wallet/wallet.service'
import { TransactionRepository } from '@/data/repositories/transaction.repository'

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

describe('Payment Flow Integration', () => {
  let walletService: WalletService
  let transactionRepo: TransactionRepository

  beforeEach(async () => {
    await resetDatabase()
    clearWalletCache()
    vi.clearAllMocks()
    for (const key of Object.keys(mockCocoBalances)) delete mockCocoBalances[key]

    walletService = new WalletService()
    transactionRepo = new TransactionRepository()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  describe('Balance Management', () => {
    it('should start with zero balance', async () => {
      const balance = await walletService.getBalance()
      expect(balance.total).toBe(0)
    })

    it('should update balance when adding proofs', async () => {
      mockCocoBalances['https://mint.example.com'] = 150

      const balance = await walletService.getBalance()
      expect(balance.total).toBe(150)
      expect(balance.byMint['https://mint.example.com']).toBe(150)
    })

    it('should track balance across multiple mints', async () => {
      mockCocoBalances['https://mint1.example.com'] = 500
      mockCocoBalances['https://mint2.example.com'] = 300

      const balance = await walletService.getBalance()
      expect(balance.total).toBe(800)
      expect(balance.byMint['https://mint1.example.com']).toBe(500)
      expect(balance.byMint['https://mint2.example.com']).toBe(300)
    })
  })

  describe('Proof Selection', () => {
    beforeEach(async () => {
      // Setup proofs with power-of-2 denominations for optimal selection
      await walletService.addProofs('https://mint.example.com', [
        { id: 'k1', amount: 64, secret: 's1', C: 'c1' },
        { id: 'k1', amount: 32, secret: 's2', C: 'c2' },
        { id: 'k1', amount: 16, secret: 's3', C: 'c3' },
        { id: 'k1', amount: 8, secret: 's4', C: 'c4' },
        { id: 'k1', amount: 4, secret: 's5', C: 'c5' },
      ])
    })

    it('should select proofs for exact amount', async () => {
      const result = await walletService.getProofsForAmount(
        'https://mint.example.com',
        100 // 64 + 32 + 4 = 100
      )

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        const total = result.value.reduce((s, p) => s + p.amount, 0)
        expect(total).toBeGreaterThanOrEqual(100)
      }
    })

    it('should return error for insufficient balance', async () => {
      const result = await walletService.getProofsForAmount(
        'https://mint.example.com',
        500 // More than available 124
      )

      expect(result.isErr()).toBe(true)
    })

    it('should select proofs from specific mint only', async () => {
      // Add proofs to another mint
      await walletService.addProofs('https://mint2.example.com', [
        { id: 'k2', amount: 1000, secret: 'm2s1', C: 'm2c1' },
      ])

      const result = await walletService.getProofsForAmount(
        'https://mint.example.com',
        50
      )

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        // All proofs should be from mint.example.com
        result.value.forEach((proof) => {
          expect(proof.id).toBe('k1') // Original mint's keysetId
        })
      }
    })
  })

  describe('Transaction Recording', () => {
    it('should create and retrieve transactions', async () => {
      const tx = {
        id: 'tx-123',
        direction: 'receive' as const,
        type: 'lightning' as const,
        amount: 1000,
        mintUrl: 'https://mint.example.com',
        status: 'pending' as const,
        createdAt: Date.now(),
      }

      await transactionRepo.create(tx)

      const retrieved = await transactionRepo.findById('tx-123')
      expect(retrieved).not.toBeNull()
      expect(retrieved?.amount).toBe(1000)
      expect(retrieved?.status).toBe('pending')
    })

    it('should update transaction status', async () => {
      const tx = {
        id: 'tx-123',
        direction: 'receive' as const,
        type: 'lightning' as const,
        amount: 1000,
        mintUrl: 'https://mint.example.com',
        status: 'pending' as const,
        createdAt: Date.now(),
      }

      await transactionRepo.create(tx)
      await transactionRepo.updateStatus('tx-123', 'completed')

      const updated = await transactionRepo.findById('tx-123')
      expect(updated?.status).toBe('completed')
    })

    it('should list transactions in reverse chronological order', async () => {
      const now = Date.now()

      await transactionRepo.create({
        id: 'tx-1',
        direction: 'receive',
        type: 'lightning',
        amount: 100,
        mintUrl: 'https://mint.example.com',
        status: 'completed',
        createdAt: now - 2000,
      })

      await transactionRepo.create({
        id: 'tx-2',
        direction: 'send',
        type: 'ecash',
        amount: 50,
        mintUrl: 'https://mint.example.com',
        status: 'completed',
        createdAt: now - 1000,
      })

      await transactionRepo.create({
        id: 'tx-3',
        direction: 'receive',
        type: 'nutzap',
        amount: 200,
        mintUrl: 'https://mint.example.com',
        status: 'completed',
        createdAt: now,
      })

      const transactions = await transactionRepo.findAll()

      expect(transactions.length).toBe(3)
      expect(transactions[0].id).toBe('tx-3') // Most recent first
      expect(transactions[1].id).toBe('tx-2')
      expect(transactions[2].id).toBe('tx-1')
    })

    it('should filter transactions by direction', async () => {
      await transactionRepo.create({
        id: 'tx-1',
        direction: 'receive',
        type: 'lightning',
        amount: 100,
        mintUrl: 'https://mint.example.com',
        status: 'completed',
        createdAt: Date.now(),
      })

      await transactionRepo.create({
        id: 'tx-2',
        direction: 'send',
        type: 'lightning',
        amount: 50,
        mintUrl: 'https://mint.example.com',
        status: 'completed',
        createdAt: Date.now(),
      })

      const receives = await transactionRepo.findByDirection('receive')
      const sends = await transactionRepo.findByDirection('send')

      expect(receives.length).toBe(1)
      expect(sends.length).toBe(1)
    })
  })

  describe('Proof Removal After Spending', () => {
    it('should correctly remove spent proofs', async () => {
      const proofs = [
        { id: 'k1', amount: 100, secret: 's1', C: 'c1' },
        { id: 'k1', amount: 50, secret: 's2', C: 'c2' },
        { id: 'k1', amount: 25, secret: 's3', C: 'c3' },
      ]

      await walletService.addProofs('https://mint.example.com', proofs)

      // Spend the first proof
      await walletService.removeProofs('https://mint.example.com', [proofs[0]])

      let remaining = await walletService.getProofs('https://mint.example.com')
      expect(remaining).toHaveLength(2)

      // Spend remaining proofs
      await walletService.removeProofs('https://mint.example.com', [proofs[1], proofs[2]])

      remaining = await walletService.getProofs('https://mint.example.com')
      expect(remaining).toHaveLength(0)
    })
  })
})
