/**
 * NostrSessionController — 연결/구독 레지스트리 (설계 §9/§10 B2~B4·B6)
 *
 * 핵심 불변식:
 * - attach 보장: (재)연결되는 relay에 등록 구독이 자동으로 붙는다
 * - 재연결 시 해당 relay만 재개 — 전 구독×전 relay 재오픈 없음
 * - session lease: refcount+TTL, persistent∩session이면 lease가 닫지 않는다
 * - publishScoped가 persistent 집합을 오염시키지 않는다 (DM 버그의 근본 수정)
 * - collectUntilEose: relay별 since, id dedup, 진짜 EOSE만 eosed에 기록
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

  describe('구독 attach 보장 (B3/B4)', () => {
    it('attaches an existing subscription when a relay connects later', async () => {
      await controller.connectPersistent(['wss://a'])
      const onEvent = vi.fn()
      controller.subscribe([{ kinds: [1059] } as NostrFilter], onEvent)
      await flush()
      expect(mock.ensure('wss://a').subs).toHaveLength(1)

      // 나중에 persistent 집합에 b가 추가·연결되면 자동 attach
      await controller.connectPersistent(['wss://a', 'wss://b'])
      await flush()
      expect(mock.ensure('wss://b').subs).toHaveLength(1)
      // a에 중복 attach는 없다
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
    it('publishScoped does NOT change the persistent set — DM 버그 근본 수정', async () => {
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

    it('[N9] holds under URL variants — pool-정규화 정체성으로 판정 (리뷰 #4)', async () => {
      vi.useFakeTimers()
      await controller.connectPersistent(['wss://both.io'])

      // 수신자 10050이 trailing-slash 변형으로 같은 relay를 지정
      const lease = await controller.acquireSession(['wss://both.io/'], 1_000)
      lease.release()
      await vi.advanceTimersByTimeAsync(2_000)

      // 변형 표기가 lease로 등록되지 않아 공유 소켓이 닫히지 않는다
      expect(mock.closedUrls).toHaveLength(0)
      expect(controller.getRelayStatus()).toEqual([
        { url: 'wss://both.io', connected: true },
      ])
    })
  })

  describe('연결 타임아웃 (리뷰 #3)', () => {
    it('collectUntilEose caps a never-connecting relay instead of hanging', async () => {
      vi.useFakeTimers()
      // 블랙홀 네트워크 시뮬레이션: 해당 relay의 모든 ensureRelay가 영원히 pending
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

      // 연결 상한(5s)이 maxWait과 무관하게 pending을 끊는다 —
      // lease 확보와 per-relay 수집 각각의 연결 시도에 한 번씩
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

      // 다음 ensureRelay(attach 경로)가 영원히 pending
      vi.mocked(mock.pool.ensureRelay).mockImplementationOnce(
        () => new Promise<never>(() => {}),
      )
      controller.subscribe([{ kinds: [1] } as NostrFilter], vi.fn())

      await vi.advanceTimersByTimeAsync(5_001) // 타임아웃 → 자리 선점 해제
      // 네트워크 회복: 헬스체크 보충이 재-attach
      await vi.advanceTimersByTimeAsync(60_000)
      for (let i = 0; i < 5; i++) await Promise.resolve()

      expect(mock.ensure('wss://a').subs).toHaveLength(1)
    })
  })

  describe('per-relay 재연결 (B4)', () => {
    it('reattaches only the dead relay, leaving healthy attachments untouched', async () => {
      vi.useFakeTimers()
      controller = new NostrSessionController({ pool: mock.pool, reconnectIntervalMs: 1_000 })
      await controller.connectPersistent(['wss://a', 'wss://b'])
      controller.subscribe([{ kinds: [1] } as NostrFilter], vi.fn())
      await flushWithTimers()

      const aFirst = mock.ensure('wss://a').subs[0]
      expect(aFirst).toBeDefined()
      expect(mock.ensure('wss://b').subs).toHaveLength(1)

      // b의 구독이 relay측에서 종료된다(소켓 사망·CLOSED) — ensureRelay가
      // 소켓을 조용히 되살리는 경우를 포함하는 유일하게 신뢰 가능한 신호
      mock.ensure('wss://b').subs[0].opts.onclose?.('socket died')

      await vi.advanceTimersByTimeAsync(1_000) // 헬스체크 1회
      await flushWithTimers()

      // b는 재-attach(새 핸들), a의 기존 핸들은 그대로 — churn 없음
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
      // 실제 nostr-tools처럼 close()가 onclose를 발화한다
      first.opts.onclose?.('closed by caller')

      await vi.advanceTimersByTimeAsync(1_000)
      await flushWithTimers()

      expect(mock.ensure('wss://a').subs).toHaveLength(1) // 재-attach 없음
    })
  })

  describe('collectUntilEose (B5 엔진)', () => {
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
      // 합성 EOSE 차단값이 전달된다
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
      expect(eosed).toEqual([]) // timeout은 EOSE가 아니다 [N1]
      expect(mock.ensure('wss://silent').subs[0].closed).toBe(true)
    })
  })

  async function flushWithTimers() {
    // fake timers 하에서 마이크로태스크만 소진 (race 래핑 깊이 여유 포함)
    for (let i = 0; i < 12; i++) await Promise.resolve()
  }
})
