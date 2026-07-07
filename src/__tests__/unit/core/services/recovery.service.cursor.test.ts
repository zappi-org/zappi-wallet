/**
 * RecoveryService — cursor / deep-resync wiring.
 *
 * - syncAll: normal (cached anchor) → fetch with cursor spec (fullReplay:false)
 *            reinstall (isRecoveryMode) → fullReplay:true
 * - end of syncAll: 30-day age check → deep-resync (sinceSecOverride) + markDeepResync
 * - resyncFull: fullReplay:true + markDeepResync
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RecoveryService } from '@/core/services/recovery.service'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { AnchorStore } from '@/core/ports/driven/anchor.port'
import type { RecoveryStore } from '@/core/ports/driven/recovery-store.port'
import type { FailedIncomingStore } from '@/core/ports/driven/failed-incoming-store.port'
import type { TokenReceiver } from '@/core/ports/driven/token-receiver.port'
import type { TrustedMintProvider } from '@/core/ports/driven/trusted-mint-provider.port'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { GiftwrapCursorStore } from '@/core/ports/driven/giftwrap-cursor-store.port'
import {
  DEEP_RESYNC_INTERVAL_MS,
  GIFTWRAP_OVERLAP_SEC,
  createGiftwrapCursorRecord,
  toSinceSec,
} from '@/core/domain/giftwrap-cursor'

const PUBKEY = 'b'.repeat(64)
const CURSOR_KEY = 'giftwrap:bbbbbbbb'
const PARAMS = { privateKey: 'a'.repeat(64), publicKey: PUBKEY, relays: ['wss://r'] }

function makeDeps() {
  const nostr = {
    fetchGiftWraps: vi.fn().mockResolvedValue([]),
    sendGiftWrap: vi.fn().mockResolvedValue({ id: 'anchor-event' }),
  } as unknown as NostrGateway

  const validAnchor = { timestamp: Math.floor(Date.now() / 1000), eventId: 'e', cachedAt: Date.now() }
  const anchorStore: AnchorStore = {
    getCachedAnchor: vi.fn().mockReturnValue(validAnchor),
    setCachedAnchor: vi.fn(),
    clearCachedAnchor: vi.fn(),
  }

  const recoveryStore: RecoveryStore = {
    getAnchor: vi.fn().mockResolvedValue(null),
    saveAnchor: vi.fn().mockResolvedValue(undefined),
    isProcessed: vi.fn().mockResolvedValue(false),
    markProcessed: vi.fn().mockResolvedValue(undefined),
  }

  const failedIncomingStore = {
    getRetryable: vi.fn().mockResolvedValue([]),
    findAll: vi.fn().mockResolvedValue([]),
    save: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    markAsNonRetryable: vi.fn(),
    cleanupNonRetryable: vi.fn(),
  } as unknown as FailedIncomingStore

  const cursorStore: GiftwrapCursorStore = {
    load: vi.fn().mockResolvedValue(null),
    markAttempt: vi.fn().mockResolvedValue(undefined),
    markRelayEose: vi.fn().mockResolvedValue(undefined),
    markFullSync: vi.fn().mockResolvedValue(undefined),
    markDeepResync: vi.fn().mockResolvedValue(undefined),
  }

  const service = new RecoveryService(
    nostr,
    anchorStore,
    recoveryStore,
    failedIncomingStore,
    { receiveToken: vi.fn() } as unknown as TokenReceiver,
    { hasTrustedMint: vi.fn().mockResolvedValue(true) } as unknown as TrustedMintProvider,
    { enqueue: vi.fn() } as unknown as IncomingReviewQueue,
    { inspectCashuToken: vi.fn(), encodeCashuToken: vi.fn() } as unknown as TokenCodec,
    undefined,
    undefined,
    undefined,
    cursorStore,
  )

  return { service, nostr, anchorStore, cursorStore, failedIncomingStore }
}

describe('RecoveryService cursor wiring', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('syncAll (normal, cached anchor valid) passes a cursor spec with fullReplay:false', async () => {
    const { service, nostr } = makeDeps()

    await service.syncAll(PARAMS)

    expect(nostr.fetchGiftWraps).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientPubkey: PUBKEY,
        cursor: { key: CURSOR_KEY, fullReplay: false },
        sinceSecOverride: undefined,
      }),
    )
  })

  it('syncAll in recovery mode (reinstall) fetches with fullReplay:true', async () => {
    const { service, nostr, anchorStore } = makeDeps()
    // no local cache → remote anchor found → isRecoveryMode
    vi.mocked(anchorStore.getCachedAnchor).mockReturnValue(null)
    const anchorMsg = {
      eventId: 'anchor-1',
      sender: PUBKEY,
      content: JSON.stringify({ type: 'zappi-anchor', v: 1, timestamp: Math.floor(Date.now() / 1000) }),
    }
    // 1st call = fetchAnchors (no cursor), 2nd = reconstruct
    vi.mocked(nostr.fetchGiftWraps)
      .mockResolvedValueOnce([anchorMsg])
      .mockResolvedValue([])

    await service.syncAll(PARAMS)

    const calls = vi.mocked(nostr.fetchGiftWraps).mock.calls
    // anchor discovery must scan the full window (detecting reinstall is the point)
    expect(calls[0][0]).not.toHaveProperty('cursor')
    expect(calls[1][0]).toMatchObject({ cursor: { key: CURSOR_KEY, fullReplay: true } })
  })

  it('syncAll runs a bounded deep-resync when the 30d age check trips', async () => {
    const { service, nostr, cursorStore } = makeDeps()
    const now = Date.now()
    const oldDeep = now - DEEP_RESYNC_INTERVAL_MS - 60_000
    const record = { ...createGiftwrapCursorRecord(CURSOR_KEY, oldDeep), deepResyncAtMs: oldDeep }
    vi.mocked(cursorStore.load).mockResolvedValue(record)

    await service.syncAll(PARAMS)

    const expectedSince = toSinceSec(oldDeep) - GIFTWRAP_OVERLAP_SEC
    const calls = vi.mocked(nostr.fetchGiftWraps).mock.calls
    // 1: normal reconstruct (cursor) → 2: deep-resync (sinceSecOverride)
    expect(calls).toHaveLength(2)
    expect(calls[1][0]).toMatchObject({ sinceSecOverride: expectedSince })
    expect(cursorStore.markDeepResync).toHaveBeenCalledWith(CURSOR_KEY, expect.any(Number))
  })

  it('syncAll skips deep-resync inside the 30d window', async () => {
    const { service, nostr, cursorStore } = makeDeps()
    const record = createGiftwrapCursorRecord(CURSOR_KEY, Date.now())
    vi.mocked(cursorStore.load).mockResolvedValue(record)

    await service.syncAll(PARAMS)

    expect(vi.mocked(nostr.fetchGiftWraps).mock.calls).toHaveLength(1)
    expect(cursorStore.markDeepResync).not.toHaveBeenCalled()
  })

  it('resyncFull fetches the full window (including an extended maxWait) and resets the deep-resync clock', async () => {
    const { service, nostr, cursorStore } = makeDeps()

    await service.resyncFull(PARAMS)

    expect(nostr.fetchGiftWraps).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { key: CURSOR_KEY, fullReplay: true },
        maxWaitMs: 30_000,
      }),
    )
    expect(cursorStore.markDeepResync).toHaveBeenCalledWith(CURSOR_KEY, expect.any(Number))
  })

  /**
   * The deep marker advances only on error-free runs. A fetch failure, isSyncing
   * short-circuit, or partial failure must not silently consume the 30-day safety net.
   */
  it('does NOT advance the deep-resync clock when the deep fetch fails', async () => {
    const { service, nostr, cursorStore } = makeDeps()
    const oldDeep = Date.now() - DEEP_RESYNC_INTERVAL_MS - 60_000
    vi.mocked(cursorStore.load).mockResolvedValue({
      ...createGiftwrapCursorRecord(CURSOR_KEY, oldDeep),
      deepResyncAtMs: oldDeep,
    })
    // 1st (normal reconstruct) succeeds, 2nd (deep) fails
    vi.mocked(nostr.fetchGiftWraps)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('relay down'))

    const result = await service.syncAll(PARAMS)

    expect(cursorStore.markDeepResync).not.toHaveBeenCalled()
    expect(result.errors.some((e) => e.includes('Deep resync failed'))).toBe(true)
  })

  it('resyncFull does NOT reset the deep clock when errors occurred', async () => {
    const { service, cursorStore, failedIncomingStore } = makeDeps()
    // trigger a max-attempts error in the retry stage → result.errors non-empty
    vi.mocked(failedIncomingStore.getRetryable).mockResolvedValue([
      {
        id: 'fi-1',
        externalId: 'x',
        payload: 'cashuA...',
        accountId: 'mint',
        amount: 1,
        error: 'e',
        errorCode: 'E',
        isRetryable: true,
        attemptCount: 99,
        lastAttemptAt: 0,
        createdAt: 0,
      },
    ])

    await service.resyncFull(PARAMS)

    expect(cursorStore.markDeepResync).not.toHaveBeenCalled()
  })
})
