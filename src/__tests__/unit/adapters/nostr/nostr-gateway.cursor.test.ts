/**
 * NostrGatewayAdapter — gift wrap cursor wiring
 *
 * Covers:
 * - subscribeGiftWraps: single since = lastFullSyncAtMs − Ω, EOSE → per-relay mark,
 *   all-relay EOSE → markFullSync, no since on fullReplay/no-store/first-run (null),
 *   unsubscribe safety before async setup (load) completes, full-window fallback on store error
 * - fetchGiftWraps: single cursor since, sinceSecOverride precedence, no fullReplay
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockPublish = vi.fn().mockReturnValue([Promise.resolve()])
const mockQuerySync = vi.fn().mockResolvedValue([])
const mockEnsureRelay = vi.fn()
const mockClose = vi.fn()

vi.mock('nostr-tools/pool', () => ({
  SimplePool: class MockSimplePool {
    publish = mockPublish
    querySync = mockQuerySync
    ensureRelay = mockEnsureRelay
    close = mockClose
  },
}))

vi.mock('nostr-tools', () => ({
  finalizeEvent: vi.fn().mockImplementation((event) => ({ ...event, id: 'signed', pubkey: 'pk', sig: 's' })),
  verifyEvent: vi.fn().mockReturnValue(true),
  getPublicKey: vi.fn().mockReturnValue('derived-pubkey'),
  nip19: { npubEncode: vi.fn(), nprofileEncode: vi.fn(), decode: vi.fn() },
  nip17: {
    wrapEvent: vi.fn().mockReturnValue({ id: 'wrapped', kind: 1059 }),
    unwrapEvent: vi.fn().mockReturnValue({ content: 'hello', pubkey: 'sender-pubkey' }),
  },
}))

vi.mock('@noble/hashes/utils.js', () => ({ hexToBytes: vi.fn().mockReturnValue(new Uint8Array(32)) }))
vi.mock('nostr-tools/nip44', () => ({
  v2: { utils: { getConversationKey: vi.fn() }, encrypt: vi.fn(), decrypt: vi.fn() },
}))

import { NostrGatewayAdapter, CURSOR_EOSE_TIMEOUT_MS } from '@/adapters/nostr/nostr-gateway'
import type { GiftwrapCursorStore } from '@/core/ports/driven/giftwrap-cursor-store.port'
import {
  GIFTWRAP_OVERLAP_SEC,
  createGiftwrapCursorRecord,
  toSinceSec,
  type GiftwrapCursorRecord,
} from '@/core/domain/giftwrap-cursor'

type SubscribeOpts = { onevent: (e: unknown) => void; oneose?: () => void }

function makeRelay() {
  const subscribeCalls: Array<{ filters: Array<Record<string, unknown>>; opts: SubscribeOpts }> = []
  const relay = {
    connected: true,
    subscribe: vi.fn((filters: Array<Record<string, unknown>>, opts: SubscribeOpts) => {
      subscribeCalls.push({ filters, opts })
      return { close: vi.fn() }
    }),
  }
  return { relay, subscribeCalls }
}

function makeCursorStore(record: GiftwrapCursorRecord | null): GiftwrapCursorStore & {
  load: ReturnType<typeof vi.fn>
  markAttempt: ReturnType<typeof vi.fn>
  markRelayEose: ReturnType<typeof vi.fn>
  markFullSync: ReturnType<typeof vi.fn>
  markDeepResync: ReturnType<typeof vi.fn>
} {
  return {
    load: vi.fn().mockResolvedValue(record),
    markAttempt: vi.fn().mockResolvedValue(undefined),
    markRelayEose: vi.fn().mockResolvedValue(undefined),
    markFullSync: vi.fn().mockResolvedValue(undefined),
    markDeepResync: vi.fn().mockResolvedValue(undefined),
  }
}

const KEY = 'giftwrap:testpubk'
const FULL_SYNC_MS = 1_750_000_000_000
const EXPECTED_SINCE = toSinceSec(FULL_SYNC_MS) - GIFTWRAP_OVERLAP_SEC

function recordWithFullSync(): GiftwrapCursorRecord {
  return { ...createGiftwrapCursorRecord(KEY, FULL_SYNC_MS), lastFullSyncAtMs: FULL_SYNC_MS }
}

describe('NostrGatewayAdapter cursor wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuerySync.mockResolvedValue([])
  })

  async function connectedGateway(store: GiftwrapCursorStore | undefined, relayUrls: string[]) {
    const relays = new Map(relayUrls.map((url) => [url, makeRelay()]))
    mockEnsureRelay.mockImplementation((url: string) => Promise.resolve(relays.get(url)!.relay))
    const gateway = new NostrGatewayAdapter({ privateKeyHex: 'a'.repeat(64), cursorStore: store })
    await gateway.connect(relayUrls)
    return { gateway, relays }
  }

  describe('subscribeGiftWraps', () => {
    it('applies the single since window (lastFullSyncAtMs − Ω) to the live subscription', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway, relays } = await connectedGateway(store, ['wss://a', 'wss://b'])

      gateway.subscribeGiftWraps({ recipientPubkey: 'pk', cursor: { key: KEY } }, vi.fn())

      await vi.waitFor(() => {
        expect(relays.get('wss://a')!.relay.subscribe).toHaveBeenCalled()
        expect(relays.get('wss://b')!.relay.subscribe).toHaveBeenCalled()
      })

      const filter = relays.get('wss://a')!.subscribeCalls[0].filters[0]
      expect(filter.since).toBe(EXPECTED_SINCE)
      expect(store.markAttempt).toHaveBeenCalledWith(KEY, expect.any(Number))
    })

    it('marks per-relay EOSE and full-sync only after ALL configured targets EOSE', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway, relays } = await connectedGateway(store, ['wss://a', 'wss://b'])

      gateway.subscribeGiftWraps(
        { recipientPubkey: 'pk', cursor: { key: KEY, fullSyncTargets: ['wss://a', 'wss://b'] } },
        vi.fn(),
      )
      await vi.waitFor(() => expect(relays.get('wss://b')!.relay.subscribe).toHaveBeenCalled())

      relays.get('wss://a')!.subscribeCalls[0].opts.oneose!()
      await vi.waitFor(() =>
        expect(store.markRelayEose).toHaveBeenCalledWith(KEY, 'wss://a', expect.any(Number)),
      )
      expect(store.markFullSync).not.toHaveBeenCalled()

      relays.get('wss://b')!.subscribeCalls[0].opts.oneose!()
      await vi.waitFor(() => expect(store.markFullSync).toHaveBeenCalledTimes(1))
    })

    /**
     * All-EOSE must be judged against the configured persistent set, not the connected
     * snapshot — otherwise a down/unconnected relay is silently excluded from quorum and
     * its sole events get pushed outside the window and lost. An unconnected target sends
     * no EOSE, so the cursor is held back (safe).
     */
    it('does NOT mark full-sync when a configured target relay is not connected', async () => {
      const store = makeCursorStore(recordWithFullSync())
      // targets are a and b, but b is down / failed to connect
      const { gateway, relays } = await connectedGateway(store, ['wss://a'])

      gateway.subscribeGiftWraps(
        { recipientPubkey: 'pk', cursor: { key: KEY, fullSyncTargets: ['wss://a', 'wss://b'] } },
        vi.fn(),
      )
      await vi.waitFor(() => expect(relays.get('wss://a')!.relay.subscribe).toHaveBeenCalled())

      relays.get('wss://a')!.subscribeCalls[0].opts.oneose!()
      await vi.waitFor(() =>
        expect(store.markRelayEose).toHaveBeenCalledWith(KEY, 'wss://a', expect.any(Number)),
      )
      await new Promise((r) => setTimeout(r, 10))
      expect(store.markFullSync).not.toHaveBeenCalled()
    })

    it('never marks full-sync without configured targets (accumulates history only — under-advances)', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway, relays } = await connectedGateway(store, ['wss://a'])

      gateway.subscribeGiftWraps({ recipientPubkey: 'pk', cursor: { key: KEY } }, vi.fn())
      await vi.waitFor(() => expect(relays.get('wss://a')!.relay.subscribe).toHaveBeenCalled())

      relays.get('wss://a')!.subscribeCalls[0].opts.oneose!()
      await vi.waitFor(() => expect(store.markRelayEose).toHaveBeenCalled())
      await new Promise((r) => setTimeout(r, 10))
      expect(store.markFullSync).not.toHaveBeenCalled()
    })

    /** Block the synthetic EOSE (4.4s): cursor subscriptions must pass a huge eoseTimeout. */
    it('passes the synthetic-EOSE guard timeout to the relay subscription', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway, relays } = await connectedGateway(store, ['wss://a'])

      gateway.subscribeGiftWraps({ recipientPubkey: 'pk', cursor: { key: KEY } }, vi.fn())
      await vi.waitFor(() => expect(relays.get('wss://a')!.relay.subscribe).toHaveBeenCalled())

      const opts = relays.get('wss://a')!.subscribeCalls[0].opts as { eoseTimeout?: number }
      expect(opts.eoseTimeout).toBe(CURSOR_EOSE_TIMEOUT_MS)
    })

    /**
     * markFullSync must wait until the handlers for events received up to EOSE have
     * settled, so a crash mid-processing lets the next session window (t0−Ω) redeliver.
     */
    it('defers markFullSync until in-flight handler promises settle', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway, relays } = await connectedGateway(store, ['wss://a'])

      let resolveHandler!: () => void
      const handler = vi.fn(() => new Promise<void>((resolve) => { resolveHandler = resolve }))

      gateway.subscribeGiftWraps(
        { recipientPubkey: 'pk', cursor: { key: KEY, fullSyncTargets: ['wss://a'] } },
        handler,
      )
      await vi.waitFor(() => expect(relays.get('wss://a')!.relay.subscribe).toHaveBeenCalled())

      const call = relays.get('wss://a')!.subscribeCalls[0]
      // One event arrives before EOSE → handler pending
      call.opts.onevent({ id: 'evt-1', kind: 1059 })
      expect(handler).toHaveBeenCalledTimes(1)

      call.opts.oneose!()
      await new Promise((r) => setTimeout(r, 10))
      expect(store.markFullSync).not.toHaveBeenCalled()

      resolveHandler()
      await vi.waitFor(() => expect(store.markFullSync).toHaveBeenCalledTimes(1))
    })

    it('fullReplay skips since but still records the attempt', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway, relays } = await connectedGateway(store, ['wss://a'])

      gateway.subscribeGiftWraps(
        { recipientPubkey: 'pk', cursor: { key: KEY, fullReplay: true } },
        vi.fn(),
      )
      await vi.waitFor(() => expect(relays.get('wss://a')!.relay.subscribe).toHaveBeenCalled())

      expect(relays.get('wss://a')!.subscribeCalls[0].filters[0].since).toBeUndefined()
      expect(store.markAttempt).toHaveBeenCalled()
      expect(store.load).not.toHaveBeenCalled()
    })

    it('first run (no record) subscribes without since — one-time full replay', async () => {
      const store = makeCursorStore(null)
      const { gateway, relays } = await connectedGateway(store, ['wss://a'])

      gateway.subscribeGiftWraps({ recipientPubkey: 'pk', cursor: { key: KEY } }, vi.fn())
      await vi.waitFor(() => expect(relays.get('wss://a')!.relay.subscribe).toHaveBeenCalled())

      expect(relays.get('wss://a')!.subscribeCalls[0].filters[0].since).toBeUndefined()
    })

    it('falls back to the full window when the cursor store fails (loss-prevention first)', async () => {
      const store = makeCursorStore(recordWithFullSync())
      store.load.mockRejectedValue(new Error('dexie down'))
      const { gateway, relays } = await connectedGateway(store, ['wss://a'])

      gateway.subscribeGiftWraps({ recipientPubkey: 'pk', cursor: { key: KEY } }, vi.fn())
      await vi.waitFor(() => expect(relays.get('wss://a')!.relay.subscribe).toHaveBeenCalled())

      expect(relays.get('wss://a')!.subscribeCalls[0].filters[0].since).toBeUndefined()
    })

    it('ignores the cursor spec entirely when no store is injected (ks.cursor)', async () => {
      const { gateway, relays } = await connectedGateway(undefined, ['wss://a'])

      gateway.subscribeGiftWraps({ recipientPubkey: 'pk', cursor: { key: KEY } }, vi.fn())
      await vi.waitFor(() => expect(relays.get('wss://a')!.relay.subscribe).toHaveBeenCalled())

      const call = relays.get('wss://a')!.subscribeCalls[0]
      expect(call.filters[0].since).toBeUndefined()
      // The no-store path doesn't wire the EOSE callback either (unchanged behavior)
      expect(call.opts.oneose).toBeUndefined()
    })

    it('unsubscribe before async setup completes prevents the subscription', async () => {
      const store = makeCursorStore(recordWithFullSync())
      let resolveLoad!: (r: GiftwrapCursorRecord) => void
      store.load.mockImplementation(() => new Promise((resolve) => { resolveLoad = resolve }))
      const { gateway, relays } = await connectedGateway(store, ['wss://a'])

      const unsubscribe = gateway.subscribeGiftWraps(
        { recipientPubkey: 'pk', cursor: { key: KEY } },
        vi.fn(),
      )
      // unsubscribe while load is still pending (setup not yet complete)
      await vi.waitFor(() => expect(store.load).toHaveBeenCalled())
      unsubscribe()
      resolveLoad(recordWithFullSync())
      await new Promise((r) => setTimeout(r, 10))

      expect(relays.get('wss://a')!.relay.subscribe).not.toHaveBeenCalled()
    })
  })

  describe('fetchGiftWraps', () => {
    it('applies the cursor catch-up since to querySync', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway } = await connectedGateway(store, ['wss://a'])

      await gateway.fetchGiftWraps({ recipientPubkey: 'pk', relays: ['wss://a'], cursor: { key: KEY } })

      const filter = mockQuerySync.mock.calls.at(-1)![1] as Record<string, unknown>
      expect(filter.since).toBe(EXPECTED_SINCE)
    })

    it('sinceSecOverride wins over the cursor window (deep-resync path)', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway } = await connectedGateway(store, ['wss://a'])

      await gateway.fetchGiftWraps({
        recipientPubkey: 'pk',
        relays: ['wss://a'],
        cursor: { key: KEY },
        sinceSecOverride: 123_456,
      })

      const filter = mockQuerySync.mock.calls.at(-1)![1] as Record<string, unknown>
      expect(filter.since).toBe(123_456)
      expect(store.load).not.toHaveBeenCalled()
    })

    it('fullReplay fetches the full window (reinstall / manual full resync)', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway } = await connectedGateway(store, ['wss://a'])

      await gateway.fetchGiftWraps({
        recipientPubkey: 'pk',
        relays: ['wss://a'],
        cursor: { key: KEY, fullReplay: true },
      })

      const filter = mockQuerySync.mock.calls.at(-1)![1] as Record<string, unknown>
      expect(filter.since).toBeUndefined()
    })

    it('no cursor spec → unchanged legacy full-window behaviour', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway } = await connectedGateway(store, ['wss://a'])

      await gateway.fetchGiftWraps({ recipientPubkey: 'pk', relays: ['wss://a'] })

      const filter = mockQuerySync.mock.calls.at(-1)![1] as Record<string, unknown>
      expect(filter.since).toBeUndefined()
    })
  })
})
