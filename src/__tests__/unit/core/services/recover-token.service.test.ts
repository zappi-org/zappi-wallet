import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RecoveryService } from '@/core/services/recovery.service'
import type { AnchorStore } from '@/core/ports/driven/anchor.port'
import type { RecoveryStore } from '@/core/ports/driven/recovery-store.port'
import type { FailedIncomingStore } from '@/core/ports/driven/failed-incoming-store.port'
import type { TokenReceiver } from '@/core/ports/driven/token-receiver.port'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'

// ─── Fixtures ───

const DIRECT_TOKEN_RUMOR = JSON.stringify({
  kind: 14,
  tags: [['cashu', 'cashuBtoken123']],
  content: '',
  pubkey: 'sender-pubkey',
  created_at: 1700000000,
})

const NON_TOKEN_RUMOR = JSON.stringify({
  kind: 14,
  tags: [],
  content: 'just a message',
  pubkey: 'sender-pubkey',
  created_at: 1700000000,
})

// ─── Mocks ───

function createMocks() {
  const nostr = {
    fetchGiftWraps: vi.fn().mockResolvedValue([]),
    sendGiftWrap: vi.fn().mockResolvedValue({ id: 'event-1' }),
  } as unknown as NostrGateway

  const anchorStore: AnchorStore = {
    getCachedAnchor: vi.fn().mockReturnValue(null),
    setCachedAnchor: vi.fn(),
    clearCachedAnchor: vi.fn(),
  }

  const recoveryStore: RecoveryStore = {
    getAnchor: vi.fn().mockResolvedValue(null),
    saveAnchor: vi.fn().mockResolvedValue(undefined),
    isProcessed: vi.fn().mockResolvedValue(false),
    markProcessed: vi.fn().mockResolvedValue(undefined),
  }

  const failedIncomingStore: FailedIncomingStore = {
    save: vi.fn().mockResolvedValue(undefined),
    getRetryable: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue([]),
    markAsNonRetryable: vi.fn().mockResolvedValue(undefined),
    cleanupNonRetryable: vi.fn().mockResolvedValue(undefined),
  }

  const tokenReceiver: TokenReceiver = {
    receiveToken: vi.fn().mockResolvedValue({
      ok: true,
      value: { amount: 100, transactionId: 'tx-1' },
    }),
  }

  return { nostr, anchorStore, recoveryStore, failedIncomingStore, tokenReceiver }
}

// ─── Tests ───

describe('RecoveryService', () => {
  let service: RecoveryService
  let mocks: ReturnType<typeof createMocks>

  beforeEach(() => {
    vi.clearAllMocks()
    mocks = createMocks()
    service = new RecoveryService(
      mocks.nostr,
      mocks.anchorStore,
      mocks.recoveryStore,
      mocks.failedIncomingStore,
      mocks.tokenReceiver,
    )
  })

  // ─── reconstructState ───

  describe('reconstructState', () => {
    const params = {
      privateKey: 'priv-hex',
      publicKey: 'pub-hex',
      relays: ['wss://relay.test'],
    }

    it('processes direct token and receives ecash', async () => {
      vi.mocked(mocks.nostr.fetchGiftWraps).mockResolvedValue([
        { eventId: 'ev-1', content: DIRECT_TOKEN_RUMOR, sender: 'sender-pubkey' },
      ])

      const result = await service.reconstructState(params)

      expect(result.eventsProcessed).toBe(1)
      expect(result.tokensReceived).toBe(1)
      expect(result.amountReceived).toBe(100)
      expect(result.errors).toEqual([])
      expect(mocks.tokenReceiver.receiveToken).toHaveBeenCalledWith('cashuBtoken123')
    })

    it('skips already processed events', async () => {
      vi.mocked(mocks.nostr.fetchGiftWraps).mockResolvedValue([
        { eventId: 'ev-1', content: DIRECT_TOKEN_RUMOR, sender: 'sender-pubkey' },
      ])
      vi.mocked(mocks.recoveryStore.isProcessed).mockResolvedValue(true)

      const result = await service.reconstructState(params)

      expect(result.eventsProcessed).toBe(0)
      expect(mocks.tokenReceiver.receiveToken).not.toHaveBeenCalled()
    })

    it('skips non-token messages', async () => {
      vi.mocked(mocks.nostr.fetchGiftWraps).mockResolvedValue([
        { eventId: 'ev-1', content: NON_TOKEN_RUMOR, sender: 'sender-pubkey' },
      ])

      const result = await service.reconstructState(params)

      expect(result.eventsProcessed).toBe(1)
      expect(result.tokensReceived).toBe(0)
      expect(mocks.recoveryStore.markProcessed).toHaveBeenCalledWith(
        expect.objectContaining({ externalId: 'ev-1', result: 'skipped' }),
      )
    })

    it('queues failed retryable incoming', async () => {
      vi.mocked(mocks.nostr.fetchGiftWraps).mockResolvedValue([
        { eventId: 'ev-1', content: DIRECT_TOKEN_RUMOR, sender: 'sender-pubkey' },
      ])
      vi.mocked(mocks.tokenReceiver.receiveToken).mockResolvedValue({
        ok: false,
        error: { code: 'MINT_OFFLINE', message: 'Mint offline', isRetryable: true },
      })

      const result = await service.reconstructState(params)

      expect(result.failedIncomings).toBe(1)
      expect(mocks.failedIncomingStore.save).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: 'cashuBtoken123',
          isRetryable: true,
        }),
      )
    })

    it('does not queue non-retryable failure', async () => {
      vi.mocked(mocks.nostr.fetchGiftWraps).mockResolvedValue([
        { eventId: 'ev-1', content: DIRECT_TOKEN_RUMOR, sender: 'sender-pubkey' },
      ])
      vi.mocked(mocks.tokenReceiver.receiveToken).mockResolvedValue({
        ok: false,
        error: { code: 'TOKEN_SPENT', message: 'Already spent', isRetryable: false },
      })

      const result = await service.reconstructState(params)

      expect(result.failedIncomings).toBe(0)
      expect(mocks.failedIncomingStore.save).not.toHaveBeenCalled()
    })

    it('prevents concurrent sync', async () => {
      vi.mocked(mocks.nostr.fetchGiftWraps).mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve([]), 100)),
      )

      const [, r2] = await Promise.all([
        service.reconstructState(params),
        service.reconstructState(params),
      ])

      expect(r2.errors).toContain('Sync already in progress')
    })

    it('updates anchor after reconstruction', async () => {
      vi.mocked(mocks.nostr.fetchGiftWraps).mockResolvedValue([])

      await service.reconstructState(params)

      expect(mocks.recoveryStore.saveAnchor).toHaveBeenCalledWith(
        expect.objectContaining({ timestamp: expect.any(Number) }),
      )
    })
  })

  // ─── retryFailedIncomings ───

  describe('retryFailedIncomings', () => {
    it('retries and succeeds', async () => {
      vi.mocked(mocks.failedIncomingStore.getRetryable).mockResolvedValue([
        {
          id: 'item-1',
          payload: 'cashuBtoken',
          accountId: 'https://mint.test',
          amount: 100,
          error: '',
          errorCode: '',
          isRetryable: true,
          attemptCount: 1,
          lastAttemptAt: 0,
          createdAt: Date.now(),
        },
      ])

      const result = await service.retryFailedIncomings()

      expect(result.succeeded).toBe(1)
      expect(result.failed).toBe(0)
      expect(mocks.failedIncomingStore.delete).toHaveBeenCalledWith('item-1')
    })

    it('handles retry failure', async () => {
      vi.mocked(mocks.failedIncomingStore.getRetryable).mockResolvedValue([
        {
          id: 'item-1',
          payload: 'cashuBtoken',
          accountId: 'https://mint.test',
          amount: 100,
          error: '',
          errorCode: '',
          isRetryable: true,
          attemptCount: 1,
          lastAttemptAt: 0,
          createdAt: Date.now(),
        },
      ])
      vi.mocked(mocks.tokenReceiver.receiveToken).mockResolvedValue({
        ok: false,
        error: { code: 'MINT_OFFLINE', message: 'Still offline', isRetryable: true },
      })

      const result = await service.retryFailedIncomings()

      expect(result.succeeded).toBe(0)
      expect(result.failed).toBe(1)
      expect(mocks.failedIncomingStore.update).toHaveBeenCalledWith('item-1', expect.objectContaining({
        attemptCount: 2,
      }))
    })
  })

  // ─── getSyncStatus ───

  describe('getSyncStatus', () => {
    it('returns status with pending retries', async () => {
      vi.mocked(mocks.recoveryStore.getAnchor).mockResolvedValue({
        timestamp: 1700000000,
        updatedAt: Date.now(),
      })
      vi.mocked(mocks.failedIncomingStore.getRetryable).mockResolvedValue([
        { id: 'item-1' } as never,
      ])

      const status = await service.getSyncStatus()

      expect(status.hasAnchor).toBe(true)
      expect(status.pendingRetries).toBe(1)
      expect(status.isSyncing).toBe(false)
    })
  })
})
