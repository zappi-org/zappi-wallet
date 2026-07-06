/**
 * NostrIncomingWatcher — 단위 테스트
 *
 * Mock NostrGateway + Mock Store + Spy EventBus로
 * "발견" 흐름만 검증.
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

  it('start 호출 시 subscribeGiftWraps를 cursor 스펙과 함께 구독한다', () => {
    watcher.start('test-pubkey')
    expect(mockGateway.subscribeGiftWraps).toHaveBeenCalledWith(
      {
        recipientPubkey: 'test-pubkey',
        // 설계 §10 B5 — 계정 스코프 키 + 全EOSE 판정용 persistent 집합 (리뷰 #2)
        cursor: { key: 'giftwrap:test-pub', fullSyncTargets: ['wss://persistent.test'] },
      },
      expect.any(Function),
    )
  })

  it('stop 호출 시 구독을 해제한다', () => {
    watcher.start('test-pubkey')
    watcher.stop()
    expect(giftWrapHandler).toBeNull()
  })

  // ─── Message handling ───

  it('유효한 cashuA 토큰 수신 → PendingTransfer 생성 + store 저장 + 이벤트 발행', async () => {
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

  it('이미 처리한 eventId면 중복 생성하지 않는다', async () => {
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

  it('TLS store에 이미 있으면 중복 생성하지 않는다', async () => {
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

  it('untrusted mint면 review queue에 넣고 transfer를 생성하지 않는다', async () => {
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

    // 순서 계약 (설계 §6.2 / 3차 리뷰 blocker): durable enqueue가 processed
    // 마킹보다 먼저다 — 역순이면 마킹↔enqueue 사이 크래시 시 replay가 dedup에
    // 걸려 토큰이 영구 유실된다. 이 assertion은 선마킹으로의 회귀를 CI에서 막는다.
    const enqueueOrder = vi.mocked(mockReviewQueue.enqueue).mock.invocationCallOrder[0]
    const markOrder = vi.mocked(mockProcessedStore.save).mock.invocationCallOrder[0]
    expect(enqueueOrder).toBeLessThan(markOrder)
    expect(mockProcessedStore.save).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'event-untrusted', result: 'pending' }),
    )
  })

  it('유효하지 않은 payload면 저장하지 않는다', async () => {
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

  it('JSON 형식의 토큰도 수신한다', async () => {
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
