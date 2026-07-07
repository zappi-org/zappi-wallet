/**
 * NostrIncomingWatcher unit tests — verifies the "discovery" flow with a mock
 * NostrGateway, mock store, and spy EventBus.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NostrIncomingWatcher } from '@/adapters/nostr/nostr-incoming-watcher'
import { createEventBus, type EventBus } from '@/core/events/event-bus'
import { InMemoryPendingTransferStore } from '../../../helpers/transfer-lifecycle.mock-store'
import type { NostrGateway, UnwrappedMessage } from '@/core/ports/driven/nostr-gateway.port'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { TrustedMintProvider } from '@/core/ports/driven/trusted-mint-provider.port'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { RecoveryStore } from '@/core/ports/driven/recovery-store.port'
import { sat } from '@/core/domain/amount'

describe('NostrIncomingWatcher', () => {
  let store: InMemoryPendingTransferStore
  let eventBus: EventBus
  let watcher: NostrIncomingWatcher
  let mockGateway: NostrGateway
  let giftWrapHandler: ((msg: UnwrappedMessage) => void) | null
  let mockProcessedStore: ProcessedStore
  let mockRecoveryStore: RecoveryStore
  let mockTrustedMintProvider: TrustedMintProvider
  let mockReviewQueue: IncomingReviewQueue
  let mockTokenCodec: TokenCodec

  beforeEach(() => {
    store = new InMemoryPendingTransferStore()
    eventBus = createEventBus()
    giftWrapHandler = null

    mockProcessedStore = {
      exists: vi.fn().mockResolvedValue(false),
      save: vi.fn(),
      existsByTxId: vi.fn().mockResolvedValue(false),
      findById: vi.fn().mockResolvedValue(null),
      findByTxId: vi.fn().mockResolvedValue(null),
    }

    mockRecoveryStore = {
      isProcessed: vi.fn().mockResolvedValue(false),
    } as unknown as RecoveryStore

    mockTrustedMintProvider = {
      hasTrustedMint: vi.fn().mockResolvedValue(true),
    }

    mockReviewQueue = {
      enqueue: vi.fn().mockResolvedValue(undefined),
      listAll: vi.fn().mockResolvedValue([]),
      listByMint: vi.fn().mockResolvedValue([]),
      remove: vi.fn().mockResolvedValue(undefined),
    }

    mockTokenCodec = {
      inspectCashuToken: vi.fn().mockReturnValue({
        mint: 'https://mint.test',
        amount: sat(10),
        memo: 'test memo',
      }),
      encodeCashuToken: vi.fn().mockReturnValue('cashuAencodedtoken'),
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

    mockGateway = {
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getRelayStatus: vi.fn().mockReturnValue([]),
      publish: vi.fn(),
      queryEvents: vi.fn().mockResolvedValue([]),
      subscribe: vi.fn().mockReturnValue(() => {}),
      sendPrivateDirectMessage: vi.fn().mockResolvedValue(undefined),
      sendGiftWrap: vi.fn(),
      fetchGiftWraps: vi.fn().mockResolvedValue([]),
      subscribeGiftWraps: vi.fn().mockImplementation((_params, handler) => {
        giftWrapHandler = handler
        return () => { giftWrapHandler = null }
      }),
    } as unknown as NostrGateway

    watcher = new NostrIncomingWatcher(
      mockGateway,
      store,
      eventBus,
      mockProcessedStore,
      mockRecoveryStore,
      mockTrustedMintProvider,
      mockReviewQueue,
      mockTokenCodec,
      () => null,
      () => ['wss://persistent.test'],
    )
  })

  // ─── Start / Stop ───

  it('start subscribes to subscribeGiftWraps with the cursor spec', () => {
    watcher.start('test-pubkey')
    expect(mockGateway.subscribeGiftWraps).toHaveBeenCalledWith(
      {
        recipientPubkey: 'test-pubkey',
        // account-scoped key + persistent set used to judge full EOSE
        cursor: { key: 'giftwrap:test-pub', fullSyncTargets: ['wss://persistent.test'] },
      },
      expect.any(Function),
    )
  })

  it('stop unsubscribes', () => {
    watcher.start('test-pubkey')
    watcher.stop()
    expect(giftWrapHandler).toBeNull()
  })

  // ─── Message handling ───

  it('valid cashuA token received → creates PendingTransfer + saves to store + emits event', async () => {
    watcher.start('test-pubkey')

    const msg: UnwrappedMessage = {
      eventId: 'event-123',
      content: 'cashuAeyJt...',
      sender: 'sender-pubkey',
    }

    const received: Array<{ type: string; payload: unknown }> = []
    eventBus.on('incoming:received', (e) => {
      received.push({ type: e.type, payload: e.payload })
    })

    await giftWrapHandler?.(msg)

    const transfers = await store.listByTxId('event-123')
    expect(transfers).toHaveLength(1)
    expect(transfers[0].direction).toBe('incoming')
    expect(transfers[0].phase).toBe('preparing')
    expect(transfers[0].finality).toBe('deferred')
    expect(transfers[0].onExpiry).toBe('expire')

    const ref = transfers[0].transportRef as {
      eventId: string
      sender: string
      content: string
      token: string
    }
    expect(ref.eventId).toBe('event-123')
    expect(ref.sender).toBe('sender-pubkey')
    expect(ref.content).toBe('cashuAeyJt...')
    expect(ref.token).toBe('cashuAeyJt...')

    expect(received).toHaveLength(1)
  })

  it('does not create a duplicate for an already-processed eventId', async () => {
    vi.mocked(mockProcessedStore.exists).mockResolvedValue(true)
    watcher.start('test-pubkey')

    const msg: UnwrappedMessage = {
      eventId: 'event-123',
      content: 'cashuAeyJt...',
      sender: 'sender-pubkey',
    }

    await giftWrapHandler?.(msg)

    const transfers = await store.listByTxId('event-123')
    expect(transfers).toHaveLength(0)
  })

  it('does not create a duplicate when already in the TLS store', async () => {
    watcher.start('test-pubkey')

    const msg: UnwrappedMessage = {
      eventId: 'event-123',
      content: 'cashuAeyJt...',
      sender: 'sender-pubkey',
    }

    await giftWrapHandler?.(msg)
    await giftWrapHandler?.(msg)

    const transfers = await store.listByTxId('event-123')
    expect(transfers).toHaveLength(1)
  })

  it('an untrusted mint is enqueued to the review queue and no transfer is created', async () => {
    vi.mocked(mockTrustedMintProvider.hasTrustedMint).mockResolvedValue(false)
    watcher.start('test-pubkey')

    const msg: UnwrappedMessage = {
      eventId: 'event-untrusted',
      content: 'cashuAeyJt...',
      sender: 'sender-pubkey',
    }

    await giftWrapHandler?.(msg)

    const transfers = await store.listByTxId('event-untrusted')
    expect(transfers).toHaveLength(0)
    expect(mockReviewQueue.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        externalId: 'event-untrusted',
        source: 'gift-wrap',
      }),
    )

    // Ordering contract: the durable enqueue must happen before the processed
    // mark — reversed, a crash between mark and enqueue lets replay hit dedup and
    // the token is lost forever. This assertion guards against regressing to mark-first.
    const enqueueOrder = vi.mocked(mockReviewQueue.enqueue).mock.invocationCallOrder[0]
    const markOrder = vi.mocked(mockProcessedStore.save).mock.invocationCallOrder[0]
    expect(enqueueOrder).toBeLessThan(markOrder)
    expect(mockProcessedStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'event-untrusted', result: 'pending' }),
    )
  })

  it('does not save an invalid payload', async () => {
    watcher.start('test-pubkey')

    const msg: UnwrappedMessage = {
      eventId: 'event-789',
      content: 'just some text',
      sender: 'sender-pubkey',
    }

    await giftWrapHandler?.(msg)

    const transfers = await store.listByTxId('event-789')
    expect(transfers).toHaveLength(0)
  })

  it('also receives a JSON-format token', async () => {
    watcher.start('test-pubkey')

    const msg: UnwrappedMessage = {
      eventId: 'event-json',
      content: JSON.stringify({
        mint: 'https://mint.test',
        proofs: [{ C: 'c', amount: 10 }],
      }),
      sender: 'sender-pubkey',
    }

    await giftWrapHandler?.(msg)

    const transfers = await store.listByTxId('event-json')
    expect(transfers).toHaveLength(1)
    expect(transfers[0].direction).toBe('incoming')
  })
})
