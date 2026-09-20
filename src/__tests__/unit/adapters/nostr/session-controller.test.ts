/**
 * NostrSessionController — connection/subscription registry.
 *
 * Key invariants:
 * - Attach guarantee: registered subs auto-attach to any relay that (re)connects.
 * - Reconnect resumes only that relay — no reopening every sub × every relay.
 * - Session lease: refcount + TTL; a lease never closes a persistent∩session relay.
 * - publishScoped never pollutes the persistent set (the root DM-bug fix).
 * - collectUntilEose: per-relay since, id dedup, records only true EOSE in eosed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NostrSessionController } from '@/adapters/nostr/internal/session-controller'
import type { RelayPool, Relay } from '@/adapters/nostr/internal/nostr-relay'
import type { NostrFilter } from '@/core/domain/nostr'

interface MockSub {
  filters: Array<Record<string, unknown>>
  opts: {
    onevent: (event: unknown) => void
    oneose?: () => void
    onclose?: (reason?: string) => void
    eoseTimeout?: number
  }
  closed: boolean
}

function makeMockPool() {
  const relays = new Map<string, { connected: boolean; subs: MockSub[]; failConnect?: boolean }>()
  const closedUrls: string[] = []

  const ensure = (url: string) => {
    const state = relays.get(url) ?? { connected: true, subs: [] }
    relays.set(url, state)
    return state
  }

  const pool: RelayPool = {
    ensureRelay: vi.fn(async (url: string): Promise<Relay> => {
      const state = ensure(url)
      if (state.failConnect) throw new Error(`connect failed: ${url}`)
      state.connected = true
      return {
        get connected() {
          return state.connected
        },
        subscribe: (filters, opts) => {
          const sub: MockSub = { filters, opts, closed: false }
          state.subs.push(sub)
          return { close: () => { sub.closed = true } }
        },
      }
    }),
    publish: vi.fn((urls: string[]) => urls.map(() => Promise.resolve('ok'))),
    querySync: vi.fn(async () => []),
    close: vi.fn((urls: string[]) => closedUrls.push(...urls)),
  }

  return { pool, relays, closedUrls, ensure }
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0))
}

describe('NostrSessionController', () => {
  let mock: ReturnType<typeof makeMockPool>
  let controller: NostrSessionController

  beforeEach(() => {
    mock = makeMockPool()
    controller = new NostrSessionController({ pool: mock.pool, reconnectIntervalMs: 60_000 })
  })

  afterEach(() => {
    controller.disconnect()
    vi.useRealTimers()
  })

  describe('subscription attach guarantee (B3/B4)', () => {
    it('attaches an existing subscription when a relay connects later', async () => {
      await controller.connectPersistent(['wss://a'])
      const onEvent = vi.fn()
      controller.subscribe([{ kinds: [1059] } as NostrFilter], onEvent)
      await flush()
      expect(mock.ensure('wss://a').subs).toHaveLength(1)

      // When b is later added to the persistent set and connects, it auto-attaches.
      await controller.connectPersistent(['wss://a', 'wss://b'])
      await flush()
      expect(mock.ensure('wss://b').subs).toHaveLength(1)
      // No duplicate attach on a.
      expect(mock.ensure('wss://a').subs).toHaveLength(1)
    })

    it('unsubscribe closes every attached handle and later connects do not attach', async () => {
      await controller.connectPersistent(['wss://a'])
      const stop = controller.subscribe([{ kinds: [1] } as NostrFilter], vi.fn())
      await flush()
      stop()
      expect(mock.ensure('wss://a').subs[0].closed).toBe(true)

      await controller.connectPersistent(['wss://a', 'wss://b'])
      await flush()
      expect(mock.ensure('wss://b').subs).toHaveLength(0)
    })

    it('events reach the handler through the attached sub', async () => {
      await controller.connectPersistent(['wss://a'])
      const onEvent = vi.fn()
      controller.subscribe([{ kinds: [1] } as NostrFilter], onEvent)
      await flush()

      mock.ensure('wss://a').subs[0].opts.onevent({ id: 'ev1' })
      expect(onEvent).toHaveBeenCalledWith({ id: 'ev1' })
    })
  })

  describe('session lease (B3)', () => {
    it('publishScoped does NOT change the persistent set — root fix for the DM bug', async () => {
      await controller.connectPersistent(['wss://mine'])

      await controller.publishScoped(['wss://recipient'], { id: 'dm' })

      expect(controller.getRelayStatus().map((s) => s.url)).toEqual(['wss://mine'])
      expect(controller.getConnectedPersistent()).toEqual(['wss://mine'])
    })

    it('closes a session relay only after TTL with zero refs', async () => {
      vi.useFakeTimers()
      await controller.connectPersistent(['wss://mine'])

      const lease = await controller.acquireSession(['wss://dm'], 1_000)
      lease.release()
      expect(mock.closedUrls).not.toContain('wss://dm')

      await vi.advanceTimersByTimeAsync(1_001)
      expect(mock.closedUrls).toContain('wss://dm')
    })

    it('re-acquire within TTL cancels the pending close (refcount)', async () => {
      vi.useFakeTimers()
      const first = await controller.acquireSession(['wss://dm'], 1_000)
      first.release()

      const second = await controller.acquireSession(['wss://dm'], 1_000)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(mock.closedUrls).not.toContain('wss://dm')
      second.release()
      await vi.advanceTimersByTimeAsync(1_001)
      expect(mock.closedUrls).toContain('wss://dm')
    })

    it('persistent∩session: lease expiry never closes a persistent relay [N9]', async () => {
      vi.useFakeTimers()
      await controller.connectPersistent(['wss://both'])

      const lease = await controller.acquireSession(['wss://both'], 1_000)
      lease.release()
      await vi.advanceTimersByTimeAsync(2_000)

      expect(mock.closedUrls).not.toContain('wss://both')
      expect(controller.getConnectedPersistent()).toEqual(['wss://both'])
    })

    it('[N9] holds under URL variants — judged by pool-normalized identity (review #4)', async () => {
      vi.useFakeTimers()
      await controller.connectPersistent(['wss://both.io'])

      // The recipient's 10050 points to the same relay with a trailing-slash variant.
      const lease = await controller.acquireSession(['wss://both.io/'], 1_000)
      lease.release()
      await vi.advanceTimersByTimeAsync(2_000)

      // The variant spelling isn't registered as a lease, so the shared socket stays open.
      expect(mock.closedUrls).toHaveLength(0)
      expect(controller.getRelayStatus()).toEqual([
        { url: 'wss://both.io', connected: true },
      ])
    })
  })

  describe('connection timeout (review #3)', () => {
    it('collectUntilEose caps a never-connecting relay instead of hanging', async () => {
      vi.useFakeTimers()
      // Simulate a black-hole network: every ensureRelay for this relay stays pending forever.
      const original = vi.mocked(mock.pool.ensureRelay).getMockImplementation()!
      vi.mocked(mock.pool.ensureRelay).mockImplementation((url: string) =>
        url === 'wss://blackhole' ? new Promise<never>(() => {}) : original(url),
      )

      const promise = controller.collectUntilEose({
        relays: ['wss://blackhole'],
        filterFor: () => ({ kinds: [1059] }) as NostrFilter,
        maxWaitMs: 60_000,
        eoseGuardMs: 999_999,
      })

      // The 5s connect cap breaks the pending independent of maxWait —
      // once each for the lease-acquire and per-relay-collect connect attempts.
      await vi.advanceTimersByTimeAsync(5_001)
      await vi.advanceTimersByTimeAsync(5_001)
      const { events, eosed } = await promise
      expect(events).toEqual([])
      expect(eosed).toEqual([])
    })

    it('a hanging attach clears its placeholder so recovery can re-attach', async () => {
      vi.useFakeTimers()
      controller = new NostrSessionController({ pool: mock.pool, reconnectIntervalMs: 60_000 })
      await controller.connectPersistent(['wss://a'])

      // The next ensureRelay (the attach path) stays pending forever.
      vi.mocked(mock.pool.ensureRelay).mockImplementationOnce(
        () => new Promise<never>(() => {}),
      )
      controller.subscribe([{ kinds: [1] } as NostrFilter], vi.fn())

      await vi.advanceTimersByTimeAsync(5_001) // timeout → release the placeholder
      // Network recovers: the health-check top-up re-attaches.
      await vi.advanceTimersByTimeAsync(60_000)
      for (let i = 0; i < 5; i++) await Promise.resolve()

      expect(mock.ensure('wss://a').subs).toHaveLength(1)
    })
  })

  describe('per-relay reconnect (B4)', () => {
    it('reattaches only the dead relay, leaving healthy attachments untouched', async () => {
      vi.useFakeTimers()
      controller = new NostrSessionController({ pool: mock.pool, reconnectIntervalMs: 1_000 })
      await controller.connectPersistent(['wss://a', 'wss://b'])
      controller.subscribe([{ kinds: [1] } as NostrFilter], vi.fn())
      await flushWithTimers()

      const aFirst = mock.ensure('wss://a').subs[0]
      expect(aFirst).toBeDefined()
      expect(mock.ensure('wss://b').subs).toHaveLength(1)

      // b's sub is closed relay-side (socket death / CLOSED) — the only reliable
      // signal, covering the case where ensureRelay quietly revives the socket.
      mock.ensure('wss://b').subs[0].opts.onclose?.('socket died')

      await vi.advanceTimersByTimeAsync(1_000) // one health-check
      await flushWithTimers()

      // b re-attaches (new handle); a's existing handle is untouched — no churn.
      expect(mock.ensure('wss://b').subs).toHaveLength(2)
      expect(mock.ensure('wss://a').subs).toHaveLength(1)
      expect(aFirst.closed).toBe(false)
    })

    it('self unsubscribe does not trigger reattach via its own onclose', async () => {
      vi.useFakeTimers()
      controller = new NostrSessionController({ pool: mock.pool, reconnectIntervalMs: 1_000 })
      await controller.connectPersistent(['wss://a'])
      const stop = controller.subscribe([{ kinds: [1] } as NostrFilter], vi.fn())
      await flushWithTimers()

      const first = mock.ensure('wss://a').subs[0]
      stop()
      // Like real nostr-tools, close() fires onclose.
      first.opts.onclose?.('closed by caller')

      await vi.advanceTimersByTimeAsync(1_000)
      await flushWithTimers()

      expect(mock.ensure('wss://a').subs).toHaveLength(1) // no re-attach
    })
  })

  describe('collectUntilEose (B5 engine)', () => {
    it('applies per-relay filters, dedups by id, and reports only true-EOSE relays', async () => {
      const promise = controller.collectUntilEose({
        relays: ['wss://a', 'wss://b'],
        filterFor: (url) => ({ kinds: [1059], since: url === 'wss://a' ? 100 : 200 }) as NostrFilter,
        maxWaitMs: 5_000,
        eoseGuardMs: 999_999,
      })
      await flush()

      const subA = mock.ensure('wss://a').subs[0]
      const subB = mock.ensure('wss://b').subs[0]
      expect(subA.filters[0].since).toBe(100)
      expect(subB.filters[0].since).toBe(200)
      // The synthetic-EOSE guard value is passed through.
      expect(subA.opts.eoseTimeout).toBe(999_999)

      subA.opts.onevent({ id: 'dup' })
      subB.opts.onevent({ id: 'dup' })
      subB.opts.onevent({ id: 'only-b' })
      subA.opts.oneose?.()
      subB.opts.oneose?.()

      const { events, eosed } = await promise
      expect(events.map((e) => e.id).sort()).toEqual(['dup', 'only-b'])
      expect(eosed.sort()).toEqual(['wss://a', 'wss://b'])
    })

    it('caps a silent relay at maxWaitMs without recording EOSE', async () => {
      vi.useFakeTimers()
      const promise = controller.collectUntilEose({
        relays: ['wss://silent'],
        filterFor: () => ({ kinds: [1059] }) as NostrFilter,
        maxWaitMs: 1_000,
        eoseGuardMs: 999_999,
      })
      await flushWithTimers()
      mock.ensure('wss://silent').subs[0].opts.onevent({ id: 'partial' })

      await vi.advanceTimersByTimeAsync(1_001)
      const { events, eosed } = await promise

      expect(events.map((e) => e.id)).toEqual(['partial'])
      expect(eosed).toEqual([]) // a timeout is not an EOSE
      expect(mock.ensure('wss://silent').subs[0].closed).toBe(true)
    })
  })

  async function flushWithTimers() {
    // Drain only microtasks under fake timers (with slack for race-wrapping depth).
    for (let i = 0; i < 12; i++) await Promise.resolve()
  }
})
