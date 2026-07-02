/**
 * NostrGatewayAdapter — gift wrap cursor 배선 (설계 §10 B5, 2단계)
 *
 * 검증 대상:
 * - subscribeGiftWraps: since = lastFullSyncAtMs − Ω 단일값, EOSE → per-relay 마크,
 *   전(全) relay EOSE → markFullSync, fullReplay/스토어 미주입/최초(null) 시 since 미적용,
 *   setup(비동기 load) 완료 전 unsubscribe 안전성, store 오류 시 전체 창 폴백
 * - fetchGiftWraps: cursor 단일 since, sinceSecOverride 우선, fullReplay 미적용
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
     * 리뷰 #2 — 全EOSE 판정은 **설정된 persistent 집합** 기준이어야 한다.
     * 연결 스냅샷 기준이면 다운/미연결 relay가 조용히 빠져(사실상 quorum 제외)
     * 그 relay 단독 이벤트가 창 밖으로 밀려 유실된다. 미연결 target은 EOSE가
     * 없으므로 cursor를 붙든다(안전).
     */
    it('does NOT mark full-sync when a configured target relay is not connected', async () => {
      const store = makeCursorStore(recordWithFullSync())
      // target은 a,b 두 개지만 b는 연결 실패/다운
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

    it('never marks full-sync without configured targets (이력만 축적 — 과소 전진)', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway, relays } = await connectedGateway(store, ['wss://a'])

      gateway.subscribeGiftWraps({ recipientPubkey: 'pk', cursor: { key: KEY } }, vi.fn())
      await vi.waitFor(() => expect(relays.get('wss://a')!.relay.subscribe).toHaveBeenCalled())

      relays.get('wss://a')!.subscribeCalls[0].opts.oneose!()
      await vi.waitFor(() => expect(store.markRelayEose).toHaveBeenCalled())
      await new Promise((r) => setTimeout(r, 10))
      expect(store.markFullSync).not.toHaveBeenCalled()
    })

    /** 리뷰 #1 — 합성 EOSE(4.4s) 차단: cursor 구독은 거대 eoseTimeout을 전달해야 한다 */
    it('passes the synthetic-EOSE guard timeout to the relay subscription', async () => {
      const store = makeCursorStore(recordWithFullSync())
      const { gateway, relays } = await connectedGateway(store, ['wss://a'])

      gateway.subscribeGiftWraps({ recipientPubkey: 'pk', cursor: { key: KEY } }, vi.fn())
      await vi.waitFor(() => expect(relays.get('wss://a')!.relay.subscribe).toHaveBeenCalled())

      const opts = relays.get('wss://a')!.subscribeCalls[0].opts as { eoseTimeout?: number }
      expect(opts.eoseTimeout).toBe(CURSOR_EOSE_TIMEOUT_MS)
    })

    /**
     * 리뷰 #4 — full-sync 마크는 EOSE까지 도착한 이벤트들의 handler가 settle된
     * 뒤여야 한다. 처리 중 크래시 시 다음 세션 창(t0−Ω)이 재전달을 보장하도록.
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
      // EOSE 이전에 이벤트 1건 도착 → handler pending
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
      // cursor 미주입 경로는 EOSE 콜백도 배선하지 않는다 (구동작 그대로)
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
      // load가 pending인 시점(=setup 미완료)에 unsubscribe
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

    it('fullReplay fetches the full window (재설치·수동 전체 재동기화)', async () => {
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
