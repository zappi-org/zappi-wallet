import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GIFT_WRAP_SYNC } from '@/core/constants'
import { amount } from '@/core/domain/amount'
import { GiftWrapInboxService } from '@/core/services/gift-wrap-inbox.service'
import type { EventBus } from '@/core/events/event-bus'
import type { GiftWrapInboxStore } from '@/core/ports/driven/gift-wrap-inbox-store.port'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { NostrGateway, UnwrappedMessage } from '@/core/ports/driven/nostr-gateway.port'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { TrustedMintProvider } from '@/core/ports/driven/trusted-mint-provider.port'
import type { IncomingPaymentUseCase } from '@/core/ports/driving/incoming-payment.usecase'
import type {
  GiftWrapInboxItem,
  GiftWrapInboxSource,
  GiftWrapInboxStatus,
  GiftWrapInboxTokenInfo,
  GiftWrapRelayCursor,
} from '@/core/types'

class MemoryGiftWrapInboxStore implements GiftWrapInboxStore {
  readonly items = new Map<string, GiftWrapInboxItem>()
  readonly cursors = new Map<string, GiftWrapRelayCursor>()

  async upsertMessage(
    message: UnwrappedMessage,
    source: GiftWrapInboxSource,
  ): Promise<{ item: GiftWrapInboxItem; inserted: boolean }> {
    const now = Date.now()
    const existing = this.items.get(message.eventId)
    if (existing) {
      const item = {
        ...existing,
        lastSeenAt: now,
        updatedAt: now,
        relayUrls: [...new Set([...existing.relayUrls, ...(message.relayUrl ? [message.relayUrl] : [])])],
      }
      this.items.set(item.eventId, item)
      return { item, inserted: false }
    }

    const item: GiftWrapInboxItem = {
      eventId: message.eventId,
      content: message.content,
      senderPubkey: message.sender,
      outerCreatedAt: message.createdAt,
      innerCreatedAt: message.innerCreatedAt,
      firstSeenAt: now,
      lastSeenAt: now,
      updatedAt: now,
      source,
      status: 'pending',
      relayUrls: message.relayUrl ? [message.relayUrl] : [],
      attemptCount: 0,
    }
    this.items.set(item.eventId, item)
    return { item, inserted: true }
  }

  async claimNext(params: {
    limit: number
    staleProcessingBefore: number
    retryFailedBefore: number
    now: number
  }): Promise<GiftWrapInboxItem[]> {
    const candidates = [...this.items.values()]
      .filter((item) => {
        if (item.status === 'pending') return true
        if (item.status === 'processing') return (item.lastAttemptAt ?? item.updatedAt) < params.staleProcessingBefore
        if (item.status === 'failed') return (item.lastAttemptAt ?? item.updatedAt) < params.retryFailedBefore
        return false
      })
      .sort((a, b) => a.firstSeenAt - b.firstSeenAt)
      .slice(0, params.limit)

    return candidates.map((item) => {
      const claimed: GiftWrapInboxItem = {
        ...item,
        status: 'processing',
        attemptCount: item.attemptCount + 1,
        lastAttemptAt: params.now,
        updatedAt: params.now,
        error: undefined,
      }
      this.items.set(claimed.eventId, claimed)
      return claimed
    })
  }

  async listByStatus(status: GiftWrapInboxStatus): Promise<GiftWrapInboxItem[]> {
    return [...this.items.values()].filter((item) => item.status === status)
  }

  async markReviewPending(eventId: string, tokenInfo: GiftWrapInboxTokenInfo): Promise<void> {
    this.update(eventId, { status: 'review_pending', tokenInfo, error: undefined })
  }

  async markProcessed(eventId: string, txId?: string): Promise<void> {
    this.update(eventId, { status: 'processed', txId, processedAt: Date.now(), error: undefined })
  }

  async markSkipped(eventId: string, error?: string): Promise<void> {
    this.update(eventId, { status: 'skipped', processedAt: Date.now(), error })
  }

  async markFailed(eventId: string, error: string): Promise<void> {
    this.update(eventId, { status: 'failed', error })
  }

  async getRelayCursor(relayUrl: string): Promise<GiftWrapRelayCursor | null> {
    return this.cursors.get(relayUrl) ?? null
  }

  async saveRelayCursor(cursor: GiftWrapRelayCursor): Promise<void> {
    this.cursors.set(cursor.relayUrl, cursor)
  }

  private update(eventId: string, patch: Partial<GiftWrapInboxItem>): void {
    const item = this.items.get(eventId)
    if (!item) return
    this.items.set(eventId, { ...item, ...patch, updatedAt: Date.now() })
  }
}

describe('GiftWrapInboxService', () => {
  let inboxStore: MemoryGiftWrapInboxStore
  let processedIds: Set<string>
  let nostrGateway: NostrGateway
  let processedStore: ProcessedStore
  let incomingPayment: IncomingPaymentUseCase
  let trustedMintProvider: TrustedMintProvider
  let incomingReviewQueue: IncomingReviewQueue
  let tokenCodec: TokenCodec
  let eventBus: EventBus

  const createService = () => new GiftWrapInboxService({
    nostrGateway,
    inboxStore,
    processedStore,
    incomingPayment,
    trustedMintProvider,
    incomingReviewQueue,
    tokenCodec,
    eventBus,
    getPosDevices: () => [{
      index: 0,
      nostrPublicKey: 'sender-pubkey',
      p2pkPublicKey: 'p2pk-pubkey',
      label: 'POS',
      createdAt: 1,
    }],
  })

  beforeEach(() => {
    inboxStore = new MemoryGiftWrapInboxStore()
    processedIds = new Set()
    nostrGateway = {
      fetchGiftWraps: vi.fn().mockResolvedValue([]),
      getRelayStatus: vi.fn().mockReturnValue([{ url: 'wss://relay.test', connected: true }]),
      sendPrivateDirectMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as NostrGateway
    processedStore = {
      exists: vi.fn(async (externalId: string) => processedIds.has(externalId)),
      save: vi.fn(async (record) => { processedIds.add(record.externalId) }),
      existsByTxId: vi.fn(),
      findById: vi.fn(),
      findByTxId: vi.fn(),
    }
    incomingPayment = {
      processIncoming: vi.fn().mockResolvedValue({
        status: 'success',
        amount: 99,
        fee: 1,
        requestFulfilled: true,
      }),
    }
    trustedMintProvider = {
      hasTrustedMint: vi.fn().mockResolvedValue(true),
    }
    incomingReviewQueue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
    }
    tokenCodec = {
      inspectCashuToken: vi.fn().mockReturnValue({
        mint: 'https://mint.test',
        amount: amount(100, 'sat'),
      }),
      encodeCashuToken: vi.fn().mockReturnValue('cashuBencoded'),
      isCashuToken: vi.fn(),
      isBolt11: vi.fn(),
      decodeBolt11: vi.fn(),
      isLightningAddress: vi.fn(),
      parseBitcoinUri: vi.fn(),
      decodePaymentRequest: vi.fn(),
      encodePaymentRequest: vi.fn(),
      createNostrPaymentRequest: vi.fn(),
      createDualTransportPaymentRequest: vi.fn(),
      buildUnifiedBitcoinUri: vi.fn(),
    } as unknown as TokenCodec
    eventBus = {
      emit: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    }
  })

  it('processes trusted gift-wrap tokens through incoming payment once', async () => {
    const service = createService()
    await service.ingest({
      eventId: 'event-1',
      content: JSON.stringify({ type: 'cashu_token', token: 'cashuAtoken', request_id: 'request-1' }),
      sender: 'sender-pubkey',
      createdAt: 100,
      relayUrl: 'wss://relay.test',
    }, 'live')

    const result = await service.processPending()

    expect(result.tokensReceived).toBe(1)
    expect(incomingPayment.processIncoming).toHaveBeenCalledWith({
      payload: 'cashuAtoken',
      externalId: 'event-1',
      memo: undefined,
      metadata: {
        source: 'gift-wrap',
        counterpartyAddressType: 'npub',
        counterpartyPubkey: 'sender-pubkey',
        sender: 'sender-pubkey',
        eventId: 'event-1',
      },
      receiveRequestPaymentRef: 'request-1',
      receiveRequestMethod: 'ecash',
    })
    expect(inboxStore.items.get('event-1')?.status).toBe('processed')
    expect(eventBus.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'receive:settled' }))
    expect(nostrGateway.sendPrivateDirectMessage).toHaveBeenCalledWith({
      recipientPubkey: 'sender-pubkey',
      content: JSON.stringify({ type: 'delivery_ack', txId: 'request-1' }),
      relays: ['wss://relay.test'],
    })
  })

  it('persists untrusted review state and requeues it after restart', async () => {
    vi.mocked(trustedMintProvider.hasTrustedMint).mockResolvedValue(false)
    const service = createService()
    await service.ingest({
      eventId: 'event-review',
      content: 'cashuAtoken',
      sender: 'sender-pubkey',
      createdAt: 100,
    }, 'live')

    await service.processPending()
    expect(inboxStore.items.get('event-review')?.status).toBe('review_pending')
    expect(incomingReviewQueue.enqueue).toHaveBeenCalledTimes(1)

    const restartedService = createService()
    await restartedService.processPending()
    expect(incomingReviewQueue.enqueue).toHaveBeenCalledTimes(2)
    expect(incomingPayment.processIncoming).not.toHaveBeenCalled()
  })

  it('keeps catch-up gift-wrap reviews as gift-wrap sourced', async () => {
    vi.mocked(trustedMintProvider.hasTrustedMint).mockResolvedValue(false)
    const service = createService()
    await service.ingest({
      eventId: 'event-catch-up-review',
      content: 'cashuAtoken',
      sender: 'sender-pubkey',
      createdAt: 100,
    }, 'catch-up')

    await service.processPending()

    expect(incomingReviewQueue.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      externalId: 'event-catch-up-review',
      senderPubkey: 'sender-pubkey',
      source: 'gift-wrap',
    }))
  })

  it('fetches missed events with relay cursors, overlap, and per-relay failure isolation', async () => {
    const service = createService()
    await inboxStore.saveRelayCursor({
      relayUrl: 'wss://good.test',
      lastSeenCreatedAt: 1_000,
      updatedAt: 1,
    })
    vi.mocked(nostrGateway.fetchGiftWraps).mockImplementation(async ({ relays }) => {
      if (relays[0] === 'wss://bad.test') {
        throw new Error('relay down')
      }
      return [{
        eventId: 'event-sync',
        content: 'cashuAtoken',
        sender: 'sender-pubkey',
        createdAt: 1_200,
        relayUrl: relays[0],
      }]
    })

    const result = await service.syncMissed({
      publicKey: 'recipient-pubkey',
      relays: ['wss://good.test', 'wss://bad.test'],
    })

    expect(nostrGateway.fetchGiftWraps).toHaveBeenCalledWith({
      recipientPubkey: 'recipient-pubkey',
      relays: ['wss://good.test'],
      since: Math.max(0, 1_000 - GIFT_WRAP_SYNC.TIMESTAMP_OVERLAP_SECONDS),
    })
    expect(result.eventsFetched).toBe(1)
    expect(result.tokensReceived).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(await inboxStore.getRelayCursor('wss://good.test')).toEqual(expect.objectContaining({
      relayUrl: 'wss://good.test',
    }))
    expect(await inboxStore.getRelayCursor('wss://bad.test')).toBeNull()
  })
})
