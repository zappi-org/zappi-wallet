import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { resetDatabase } from '@/data/database'
import { clearWalletCache } from '@/data/cache'
import { WalletService } from '@/services/wallet/wallet.service'
import { FailedIncomingRepository } from '@/data/repositories/failed-incoming.repository'
import { ProcessedRepository } from '@/data/repositories/processed.repository'
import { SettingsRepository } from '@/data/repositories/settings.repository'

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

// Mock CashuService
vi.mock('@/services/cashu/cashu.service', () => {
  class MockCashuService {
    getWallet = vi.fn().mockResolvedValue({
      mint: { mintUrl: 'https://mint.example.com' },
    })
    receiveToken = vi.fn().mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: {
        proofs: [{ id: 'k1', amount: 100, secret: 's1', C: 'c1' }],
        mintUrl: 'https://mint.example.com',
      },
    })
    decodeToken = vi.fn().mockReturnValue({
      mintUrl: 'https://mint.example.com',
      proofs: [{ amount: 100 }],
    })
    getTotalAmount = vi.fn().mockImplementation((proofs: { amount: number }[]) =>
      proofs.reduce((sum: number, p) => sum + p.amount, 0)
    )
  }
  return {
    CashuService: MockCashuService,
  }
})

describe('Sync/Recovery Flow Integration', () => {
  let walletService: WalletService
  let failedIncomingRepo: FailedIncomingRepository
  let processedRepo: ProcessedRepository
  let settingsRepo: SettingsRepository

  beforeEach(async () => {
    await resetDatabase()
    clearWalletCache()
    vi.clearAllMocks()
    for (const key of Object.keys(mockCocoBalances)) delete mockCocoBalances[key]

    walletService = new WalletService()
    failedIncomingRepo = new FailedIncomingRepository()
    processedRepo = new ProcessedRepository()
    settingsRepo = new SettingsRepository()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  describe('Sync Anchor Management', () => {
    it('should save and retrieve sync anchor', async () => {
      const timestamp = Date.now()

      await settingsRepo.saveSyncAnchor({
        timestamp,
        updatedAt: Date.now(),
      })

      const anchor = await settingsRepo.getSyncAnchor()
      expect(anchor).not.toBeNull()
      expect(anchor?.timestamp).toBe(timestamp)
    })

    it('should return null when no anchor exists', async () => {
      const anchor = await settingsRepo.getSyncAnchor()
      expect(anchor).toBeNull()
    })
  })

  describe('Failed Incoming Management', () => {
    it('should add and retrieve failed incomings', async () => {
      await failedIncomingRepo.add({
        id: 'item1',
        payload: 'cashuAtoken1...',
        accountId: 'https://mint.example.com',
        amount: 100,
        error: 'Mint connection failed',
        errorCode: 'MINT_CONNECTION',
        isRetryable: true,
        attemptCount: 1,
        lastAttemptAt: Date.now() - 3600000,
        createdAt: Date.now() - 7200000,
      })

      await failedIncomingRepo.add({
        id: 'item2',
        payload: 'cashuAtoken2...',
        accountId: 'https://mint.example.com',
        amount: 200,
        error: 'Network error',
        errorCode: 'NETWORK',
        isRetryable: true,
        attemptCount: 2,
        lastAttemptAt: Date.now() - 1800000,
        createdAt: Date.now() - 5400000,
      })

      const retryable = await failedIncomingRepo.getRetryable()
      expect(retryable.length).toBe(2)
    })

    it('should only return retryable items', async () => {
      await failedIncomingRepo.add({
        id: 'item1',
        payload: 'cashuAtoken1...',
        accountId: 'https://mint.example.com',
        amount: 100,
        error: 'Mint connection failed',
        errorCode: 'MINT_CONNECTION',
        isRetryable: true,
        attemptCount: 1,
        lastAttemptAt: Date.now(),
        createdAt: Date.now(),
      })

      await failedIncomingRepo.add({
        id: 'item2',
        payload: 'cashuAtoken2...',
        accountId: 'https://mint.example.com',
        amount: 200,
        error: 'Token spent',
        errorCode: 'TOKEN_SPENT',
        isRetryable: false,
        attemptCount: 1,
        lastAttemptAt: Date.now(),
        createdAt: Date.now(),
      })

      const retryable = await failedIncomingRepo.getRetryable()
      expect(retryable.length).toBe(1)
      expect(retryable[0].id).toBe('item1')
    })

    it('should delete item after successful retry', async () => {
      await failedIncomingRepo.add({
        id: 'item1',
        payload: 'cashuAtoken1...',
        accountId: 'https://mint.example.com',
        amount: 100,
        error: 'Network error',
        errorCode: 'NETWORK',
        isRetryable: true,
        attemptCount: 1,
        lastAttemptAt: Date.now(),
        createdAt: Date.now(),
      })

      let items = await failedIncomingRepo.findAll()
      expect(items.length).toBe(1)

      await failedIncomingRepo.delete('item1')

      items = await failedIncomingRepo.findAll()
      expect(items.length).toBe(0)
    })

    it('should increment attempt count on retry', async () => {
      await failedIncomingRepo.add({
        id: 'item1',
        payload: 'cashuAtoken1...',
        accountId: 'https://mint.example.com',
        amount: 100,
        error: 'Network error',
        errorCode: 'NETWORK',
        isRetryable: true,
        attemptCount: 1,
        lastAttemptAt: Date.now() - 60000,
        createdAt: Date.now() - 120000,
      })

      const item = await failedIncomingRepo.getById('item1')
      expect(item).not.toBeNull()

      await failedIncomingRepo.save({
        ...item!,
        attemptCount: item!.attemptCount + 1,
        lastAttemptAt: Date.now(),
      })

      const updated = await failedIncomingRepo.getById('item1')
      expect(updated?.attemptCount).toBe(2)
    })
  })

  describe('Processed Event Deduplication', () => {
    it('should mark event as processed', async () => {
      await processedRepo.markProcessed({
        externalId: 'event1',
        processedAt: Date.now(),
        result: 'success',
      })

      const isProcessed = await processedRepo.isProcessed('event1')
      expect(isProcessed).toBe(true)
    })

    it('should return false for unprocessed events', async () => {
      const isProcessed = await processedRepo.isProcessed('unknown-event')
      expect(isProcessed).toBe(false)
    })

    it('should not duplicate processed events', async () => {
      await processedRepo.markProcessed({
        externalId: 'event1',
        processedAt: Date.now(),
        result: 'success',
      })

      await processedRepo.markProcessed({
        externalId: 'event1',
        processedAt: Date.now(),
        result: 'success',
      })

      const count = await processedRepo.count()
      expect(count).toBe(1)
    })

    it('should track failed events', async () => {
      await processedRepo.markProcessed({
        externalId: 'event1',
        processedAt: Date.now(),
        result: 'failed',
        error: 'Token already spent',
      })

      const failed = await processedRepo.getFailed()
      expect(failed.length).toBe(1)
      expect(failed[0].externalId).toBe('event1')
      expect(failed[0].error).toBe('Token already spent')
    })
  })

  describe('Balance State After Recovery', () => {
    it('should maintain correct balance after adding proofs from multiple sources', async () => {
      mockCocoBalances['https://mint1.example.com'] = 150
      mockCocoBalances['https://mint2.example.com'] = 200

      const balance = await walletService.getBalance()

      expect(balance.total).toBe(350)
      expect(balance.byMint['https://mint1.example.com']).toBe(150)
      expect(balance.byMint['https://mint2.example.com']).toBe(200)
    })

    it('should correctly remove spent proofs', async () => {
      const proofs = [
        { id: 'k1', amount: 100, secret: 's1', C: 'c1' },
        { id: 'k1', amount: 50, secret: 's2', C: 'c2' },
      ]

      await walletService.addProofs('https://mint.example.com', proofs)

      // Remove one proof (spent)
      await walletService.removeProofs('https://mint.example.com', [proofs[0]])

      const remaining = await walletService.getProofs('https://mint.example.com')
      expect(remaining).toHaveLength(1)
      expect(remaining[0].amount).toBe(50)
    })
  })
})
