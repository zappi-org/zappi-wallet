/**
 * NostrIncomingWatcher — 단위 테스트
 *
 * Mock NostrGateway + Mock Store + Spy EventBus로
 * "발견" 흐름만 검증.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NostrIncomingWatcher } from '@/adapters/nostr/nostr-incoming-watcher'
import { createEventBus, type EventBus } from '@/core/events/event-bus'
import { InMemoryPendingTransferStore } from '@/core/services/transfer-lifecycle.service.mock-store'
import type { NostrGateway, UnwrappedMessage } from '@/core/ports/driven/nostr-gateway.port'

describe('NostrIncomingWatcher', () => {
  let store: InMemoryPendingTransferStore
  let eventBus: EventBus
  let watcher: NostrIncomingWatcher
  let mockGateway: NostrGateway
  let giftWrapHandler: ((msg: UnwrappedMessage) => void) | null

  beforeEach(() => {
    store = new InMemoryPendingTransferStore()
    eventBus = createEventBus()
    giftWrapHandler = null

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

    watcher = new NostrIncomingWatcher(mockGateway, store, eventBus)
  })

  // ─── Start / Stop ───

  it('start 호출 시 subscribeGiftWraps를 구독한다', () => {
    watcher.start('test-pubkey')
    expect(mockGateway.subscribeGiftWraps).toHaveBeenCalledWith(
      { recipientPubkey: 'test-pubkey' },
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

    // GiftWrap 메시지 시뮬레이션
    await giftWrapHandler?.(msg)

    // Store 검증
    const transfers = await store.listByTxId('event-123')
    expect(transfers).toHaveLength(1)
    expect(transfers[0].direction).toBe('incoming')
    expect(transfers[0].phase).toBe('preparing')
    expect(transfers[0].finality).toBe('deferred')
    expect(transfers[0].onExpiry).toBe('expire')

    // transportRef 검증
    const ref = transfers[0].transportRef as { eventId: string; sender: string; content: string }
    expect(ref.eventId).toBe('event-123')
    expect(ref.sender).toBe('sender-pubkey')
    expect(ref.content).toBe('cashuAeyJt...')

    // 이벤트 검증
    const emitted: Array<{ type: string; payload: unknown }> = []
    eventBus.on('incoming:received', (e) => {
      emitted.push({ type: e.type, payload: e.payload })
    })
    // 다시 메시지 보내서 이벤트 캡처
    const msg2: UnwrappedMessage = {
      eventId: 'event-456',
      content: 'cashuAeyJt...',
      sender: 'sender-pubkey',
    }
    await giftWrapHandler?.(msg2)
    expect(emitted).toHaveLength(1)
  })

  it('이미 처리한 eventId면 중복 생성하지 않는다', async () => {
    watcher.start('test-pubkey')

    const msg: UnwrappedMessage = {
      eventId: 'event-123',
      content: 'cashuAeyJt...',
      sender: 'sender-pubkey',
    }

    await giftWrapHandler?.(msg)
    await giftWrapHandler?.(msg) // 같은 eventId로 다시

    const transfers = await store.listByTxId('event-123')
    expect(transfers).toHaveLength(1)
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
      content: '{"mint":"https://mint.test","proofs":[]}',
      sender: 'sender-pubkey',
    }

    await giftWrapHandler?.(msg)

    const transfers = await store.listByTxId('event-json')
    expect(transfers).toHaveLength(1)
    expect(transfers[0].direction).toBe('incoming')
  })
})
