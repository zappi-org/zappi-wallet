import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SyncService } from '@/services/sync/sync.service'
import { resetDatabase } from '@/data/database'
import { clearWalletCache } from '@/data/cache'

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

// Mock SettingsRepository
const mockGetSyncAnchor = vi.fn()
const mockSaveSyncAnchor = vi.fn()

vi.mock('@/data/repositories/settings.repository', () => {
  class MockSettingsRepository {
    getSyncAnchor = mockGetSyncAnchor
    saveSyncAnchor = mockSaveSyncAnchor
    getSettings = vi.fn().mockResolvedValue({
      mints: ['https://mint1.com'],
      relays: ['wss://relay1.com'],
    })
  }
  return {
    SettingsRepository: MockSettingsRepository,
  }
})

// Mock ProcessedEventRepository
const mockMarkEventProcessed = vi.fn()
const mockIsEventProcessed = vi.fn()
const mockGetRecentEvents = vi.fn()

vi.mock('@/data/repositories/processed-event.repository', () => {
  class MockProcessedEventRepository {
    markProcessed = mockMarkEventProcessed
    isProcessed = mockIsEventProcessed
    getRecent = mockGetRecentEvents
  }
  return {
    ProcessedEventRepository: MockProcessedEventRepository,
  }
})

// Mock FailedSwapRepository
const mockGetRetryableSwaps = vi.fn()
const mockUpdateSwap = vi.fn()
const mockDeleteSwap = vi.fn()

vi.mock('@/data/repositories/failed-swap.repository', () => {
  class MockFailedSwapRepository {
    getRetryable = mockGetRetryableSwaps
    update = mockUpdateSwap
    delete = mockDeleteSwap
    create = vi.fn()
  }
  return {
    FailedSwapRepository: MockFailedSwapRepository,
  }
})

// Mock NostrService and giftwrap - use vi.hoisted to avoid hoisting issues
const { mockQueryEvents, mockSubscribe, mockProcessGiftWrapForNutZap } = vi.hoisted(() => ({
  mockQueryEvents: vi.fn(),
  mockSubscribe: vi.fn(),
  mockProcessGiftWrapForNutZap: vi.fn(),
}))

vi.mock('@/services/nostr/nostr.service', () => {
  class MockNostrService {
    queryEvents = mockQueryEvents
    subscribe = mockSubscribe
  }
  return {
    NostrService: MockNostrService,
  }
})

vi.mock('@/services/nostr/giftwrap', () => {
  return {
    processGiftWrapForNutZap: mockProcessGiftWrapForNutZap,
  }
})

// Mock SecurityService - use vi.hoisted
const { mockGetCachedKeys } = vi.hoisted(() => ({
  mockGetCachedKeys: vi.fn(),
}))

vi.mock('@/services/security/security.service', () => {
  class MockSecurityService {
    getCachedKeys = mockGetCachedKeys
  }
  return {
    SecurityService: MockSecurityService,
  }
})

// Mock PaymentService
const mockReceiveEcash = vi.fn()

vi.mock('@/services/payment/payment.service', () => {
  class MockPaymentService {
    receiveEcash = mockReceiveEcash
  }
  return {
    PaymentService: MockPaymentService,
  }
})

describe('SyncService', () => {
  let service: SyncService

  beforeEach(async () => {
    await resetDatabase()
    clearWalletCache()
    vi.clearAllMocks()

    // Default mocks
    mockGetSyncAnchor.mockResolvedValue(null)
    mockSaveSyncAnchor.mockResolvedValue(undefined)
    mockIsEventProcessed.mockResolvedValue(false)
    mockMarkEventProcessed.mockResolvedValue(undefined)
    mockGetRetryableSwaps.mockResolvedValue([])
    mockQueryEvents.mockResolvedValue([])
    mockGetCachedKeys.mockReturnValue({
      privateKey: 'mock-private-key-hex',
      publicKey: 'mock-public-key-hex',
    })
    mockProcessGiftWrapForNutZap.mockReturnValue(null)

    service = new SyncService()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  describe('getAnchor', () => {
    it('should return null when no anchor exists', async () => {
      mockGetSyncAnchor.mockResolvedValue(null)

      const anchor = await service.getAnchor()

      expect(anchor).toBeNull()
    })

    it('should return existing anchor', async () => {
      const mockAnchor = {
        timestamp: 1700000000,
        updatedAt: Date.now(),
      }
      mockGetSyncAnchor.mockResolvedValue(mockAnchor)

      const anchor = await service.getAnchor()

      expect(anchor).toEqual(mockAnchor)
    })
  })

  describe('updateAnchor', () => {
    it('should save a new anchor', async () => {
      const timestamp = Date.now()

      await service.updateAnchor(timestamp)

      expect(mockSaveSyncAnchor).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp,
        })
      )
    })

    it('should update existing anchor', async () => {
      mockGetSyncAnchor.mockResolvedValue({
        timestamp: 1700000000,
        updatedAt: Date.now() - 10000,
      })
      const newTimestamp = Date.now()

      await service.updateAnchor(newTimestamp)

      expect(mockSaveSyncAnchor).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: newTimestamp,
        })
      )
    })
  })

  describe('isEventProcessed', () => {
    it('should return true for already processed event', async () => {
      mockIsEventProcessed.mockResolvedValue(true)

      const result = await service.isEventProcessed('event-123')

      expect(result).toBe(true)
    })

    it('should return false for new event', async () => {
      mockIsEventProcessed.mockResolvedValue(false)

      const result = await service.isEventProcessed('event-456')

      expect(result).toBe(false)
    })
  })

  describe('markEventProcessed', () => {
    it('should mark event as processed with success', async () => {
      await service.markEventProcessed('event-123', 'success', 'tx-123')

      expect(mockMarkEventProcessed).toHaveBeenCalledWith({
        eventId: 'event-123',
        txId: 'tx-123',
        processedAt: expect.any(Number),
        result: 'success',
      })
    })

    it('should mark event as failed with error', async () => {
      await service.markEventProcessed('event-123', 'failed', undefined, 'Token spent')

      expect(mockMarkEventProcessed).toHaveBeenCalledWith({
        eventId: 'event-123',
        processedAt: expect.any(Number),
        result: 'failed',
        error: 'Token spent',
      })
    })
  })

  describe('getRecoveryTimestamp', () => {
    it('should return anchor timestamp minus buffer when anchor exists', async () => {
      const anchorTime = Math.floor(Date.now() / 1000)
      mockGetSyncAnchor.mockResolvedValue({
        timestamp: anchorTime,
        updatedAt: Date.now(),
      })

      const recoveryTime = await service.getRecoveryTimestamp()

      // Should be anchor - 2 days (buffer)
      const twoDaysInSeconds = 2 * 24 * 60 * 60
      expect(recoveryTime).toBe(anchorTime - twoDaysInSeconds)
    })

    it('should return 0 when no anchor exists', async () => {
      mockGetSyncAnchor.mockResolvedValue(null)

      const recoveryTime = await service.getRecoveryTimestamp()

      expect(recoveryTime).toBe(0)
    })
  })

  describe('reconstructState', () => {
    it('should process missed events and return sync result', async () => {
      mockGetSyncAnchor.mockResolvedValue({
        timestamp: Math.floor(Date.now() / 1000) - 3600,
        updatedAt: Date.now() - 3600000,
      })
      mockQueryEvents.mockResolvedValue([
        {
          id: 'event-1',
          kind: 1059,
          content: 'encrypted-token-1',
          created_at: Math.floor(Date.now() / 1000) - 1800,
          pubkey: 'sender-pubkey',
          tags: [],
          sig: 'sig',
        },
      ])
      mockIsEventProcessed.mockResolvedValue(false)
      // Mock gift wrap decryption returning a NutZap
      mockProcessGiftWrapForNutZap.mockReturnValue({
        token: 'cashuBtoken...',
        mintUrl: 'https://mint.com',
        amount: 100,
        senderPubkey: 'sender-pubkey',
        createdAt: Math.floor(Date.now() / 1000) - 1800,
      })
      mockReceiveEcash.mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: {
          proofs: [{ id: 'k1', amount: 100 }],
          amount: 100,
          mintUrl: 'https://mint.com',
          transactionId: 'tx-1',
        },
      })

      const result = await service.reconstructState(['wss://relay.com'])

      expect(result.eventsProcessed).toBeGreaterThanOrEqual(1)
      expect(result.tokensReceived).toBe(1)
      expect(result.amountReceived).toBe(100)
      expect(result.errors).toEqual([])
    })

    it('should skip already processed events', async () => {
      mockGetSyncAnchor.mockResolvedValue({
        timestamp: Math.floor(Date.now() / 1000) - 3600,
        updatedAt: Date.now(),
      })
      mockQueryEvents.mockResolvedValue([
        {
          id: 'already-processed',
          kind: 1059,
          content: 'content',
          created_at: Math.floor(Date.now() / 1000) - 1800,
          pubkey: 'pubkey',
          tags: [],
          sig: 'sig',
        },
      ])
      mockIsEventProcessed.mockResolvedValue(true)

      await service.reconstructState(['wss://relay.com'])

      expect(mockReceiveEcash).not.toHaveBeenCalled()
    })
  })

  describe('retryFailedSwaps', () => {
    it('should retry all retryable swaps', async () => {
      mockGetRetryableSwaps.mockResolvedValue([
        {
          id: 'swap-1',
          token: 'cashuBtoken1',
          mintUrl: 'https://mint.com',
          amount: 100,
          isRetryable: true,
          attemptCount: 1,
        },
        {
          id: 'swap-2',
          token: 'cashuBtoken2',
          mintUrl: 'https://mint.com',
          amount: 200,
          isRetryable: true,
          attemptCount: 2,
        },
      ])
      mockReceiveEcash
        .mockResolvedValueOnce({
          isOk: () => true,
          isErr: () => false,
          value: { amount: 100 },
        })
        .mockResolvedValueOnce({
          isOk: () => true,
          isErr: () => false,
          value: { amount: 200 },
        })

      const result = await service.retryFailedSwaps()

      expect(result.succeeded).toBe(2)
      expect(result.failed).toBe(0)
      expect(mockDeleteSwap).toHaveBeenCalledTimes(2)
    })

    it('should handle failed retries', async () => {
      mockGetRetryableSwaps.mockResolvedValue([
        {
          id: 'swap-1',
          token: 'cashuBtoken1',
          mintUrl: 'https://mint.com',
          amount: 100,
          isRetryable: true,
          attemptCount: 1,
        },
      ])
      mockReceiveEcash.mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: { code: 'TOKEN_SPENT', isRetryable: false },
      })

      const result = await service.retryFailedSwaps()

      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
    })
  })

  describe('getSyncStatus', () => {
    it('should return current sync status', async () => {
      mockGetSyncAnchor.mockResolvedValue({
        timestamp: Math.floor(Date.now() / 1000) - 60,
        updatedAt: Date.now() - 60000,
      })
      mockGetRetryableSwaps.mockResolvedValue([{ id: 'swap-1' }])

      const status = await service.getSyncStatus()

      expect(status.hasAnchor).toBe(true)
      expect(status.pendingRetries).toBe(1)
      expect(status.lastSyncAt).toBeDefined()
    })
  })
})
