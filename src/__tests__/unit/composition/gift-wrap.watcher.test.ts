import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GiftWrapWatcher, type GiftWrapWatcherDeps } from '@/composition/gift-wrap.watcher'

describe('GiftWrapWatcher', () => {
  let unsubscribe: ReturnType<typeof vi.fn>
  let liveHandler: ((msg: { eventId: string; content: string; sender: string; createdAt: number }) => void) | null
  let deps: GiftWrapWatcherDeps

  beforeEach(() => {
    unsubscribe = vi.fn()
    liveHandler = null
    deps = {
      nostrGateway: {
        connect: vi.fn().mockResolvedValue(undefined),
        subscribeGiftWraps: vi.fn((_params, handler) => {
          liveHandler = handler
          return unsubscribe
        }),
      } as unknown as GiftWrapWatcherDeps['nostrGateway'],
      giftWrapSync: {
        ingest: vi.fn().mockResolvedValue(undefined),
        syncMissed: vi.fn(),
        processPending: vi.fn().mockResolvedValue({
          eventsFetched: 0,
          eventsIngested: 0,
          eventsProcessed: 0,
          tokensReceived: 0,
          amountReceived: 0,
          reviewPending: 0,
          failed: 0,
          skipped: 0,
          errors: [],
        }),
        markReviewed: vi.fn(),
      },
      recipientPubkey: 'recipient-pubkey',
      getRelays: () => ['wss://relay.test'],
    }
  })

  it('connects and subscribes to gift wraps for the recipient', async () => {
    const watcher = new GiftWrapWatcher(deps)

    await watcher.start()

    expect(deps.nostrGateway.connect).toHaveBeenCalledWith(['wss://relay.test'])
    expect(deps.nostrGateway.subscribeGiftWraps).toHaveBeenCalledWith(
      { recipientPubkey: 'recipient-pubkey' },
      expect.any(Function),
    )
  })

  it('ingests live messages and runs the shared processor', async () => {
    const watcher = new GiftWrapWatcher(deps)
    await watcher.start()

    liveHandler?.({
      eventId: 'event-1',
      content: 'cashuAtoken',
      sender: 'sender-pubkey',
      createdAt: 100,
    })
    await vi.waitFor(() => {
      expect(deps.giftWrapSync.processPending).toHaveBeenCalled()
    })

    expect(deps.giftWrapSync.ingest).toHaveBeenCalledWith({
      eventId: 'event-1',
      content: 'cashuAtoken',
      sender: 'sender-pubkey',
      createdAt: 100,
    }, 'live')
  })

  it('stops and restarts the subscription cleanly', async () => {
    const watcher = new GiftWrapWatcher(deps)

    await watcher.start()
    await watcher.restart()

    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(deps.nostrGateway.subscribeGiftWraps).toHaveBeenCalledTimes(2)
  })
})
