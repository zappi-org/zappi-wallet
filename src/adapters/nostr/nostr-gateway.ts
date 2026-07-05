/**
 * NostrGatewayAdapter — NostrGateway port 구현
 *
 * relay 통신만 담당. 로컬 연산(서명, 암호화 등)은 internal/nostr-crypto.ts에서 가져다 씀.
 * relay 풀 관리는 internal/nostr-relay.ts에서 가져다 씀.
 * nostr-tools를 직접 import하지 않음 — internal/ 경유만 허용.
 *
 * 자동 재연결: connect() 이후 relay 끊김을 감지하고 subscription을 복원한다.
 * network online/offline, document visibility 변경에도 반응.
 */

import type {
  NostrGateway,
  RelayStatus,
  DirectMessageParams,
  GiftWrapParams,
  FetchGiftWrapsParams,
  SubscribeGiftWrapsParams,
  GiftwrapCursorSpec,
  UnwrappedMessage,
} from '@/core/ports/driven/nostr-gateway.port'
import type { GiftwrapCursorStore } from '@/core/ports/driven/giftwrap-cursor-store.port'
import { sinceForCatchUp, sinceForRelay } from '@/core/domain/giftwrap-cursor'
import type { NostrEvent, NostrFilter, UnsignedNostrEvent } from '@/core/domain/nostr'
import { signEvent, wrapEvent, unwrapEvent } from './internal/nostr-crypto'
import { createRelayPool, type RelayPool } from './internal/nostr-relay'
import { NostrSessionController } from './internal/session-controller'
import { RequestGate } from '@/core/utils/request-gate'
import { onWake } from '@/core/utils/wake-signal'
import { netLog } from '@/core/utils/net-log'
import { incrementNetCounter } from '@/adapters/telemetry/net-counters'

export interface NostrGatewayConfig {
  privateKeyHex: string
  defaultTimeout?: number
  reconnectIntervalMs?: number
  /**
   * Gift wrap since cursor 저장소 (설계 §10 B5). bootstrap이 kill-switch
   * `ks.cursor`가 꺼져 있을 때만 주입한다 — 미주입이면 cursor 스펙은 무시되고
   * 구동작(전체 replay)으로 동작한다.
   */
  cursorStore?: GiftwrapCursorStore
  /**
   * SessionController 위임 (설계 §9/§10 — 6단계). bootstrap이 kill-switch
   * `ks.nostr-controller`가 꺼져 있을 때만 true — false면 이 파일의 레거시
   * 연결/구독/재연결 경로 그대로 동작한다.
   */
  useSessionController?: boolean
}

// ─── Internal types ───

interface ActiveSubscription {
  filters: NostrFilter[]
  handler: (event: NostrEvent) => void
  cleanups: Set<() => void>
  onEose?: (relayUrl: string) => void
  eoseTimeoutMs?: number
}

const DEFAULT_RECONNECT_INTERVAL_MS = 30_000
const RELAY_CONNECTION_TIMEOUT_MS = 5_000

/**
 * cursor 구독의 EOSE 가드 (리뷰 #1). nostr-tools는 relay가 EOSE를 안 보내면
 * baseEoseTimeout(4400ms) 뒤 **합성 EOSE**를 같은 콜백으로 발화한다 — 백로그를
 * 아직 스트리밍 중인 relay가 "다 줬다"로 기록되면 lastFullSyncAtMs가 오염되어
 * 미수신 이벤트가 다음 세션 창 밖으로 밀린다(무음 유실). 사실상 무한대로 덮어
 * 진짜 EOSE만 cursor를 전진시킨다. 라이브러리 기본값은 pin 테스트로 감시.
 */
export const CURSOR_EOSE_TIMEOUT_MS = 24 * 60 * 60 * 1000

/**
 * 프로필류(10019 nutzap-info / 10050 DM relay list) 단일-작성자 조회의 병합 키
 * (설계 §10 B6). replaceable event 1건 조회는 10분 내 재조회가 항상 같은 답 —
 * 스캔→SendInput→확인 화면이 같은 수신자를 연달아 resolve하는 패턴의 중복 제거.
 */
function profileCoalesceKey(filter: NostrFilter): string | null {
  const kinds = filter.kinds ?? []
  const authors = filter.authors ?? []
  if (kinds.length !== 1 || authors.length !== 1) return null
  if (kinds[0] !== 10019 && kinds[0] !== 10050) return null
  return `${kinds[0]}:${authors[0]}`
}

/**
 * 빈 프로필 조회 결과 마커 (6단계 리뷰 #2): querySync는 relay 플레이크·드레인
 * 실패에도 절대 reject하지 않고 []를 준다 — []를 10분 성공-캐시하면 일시
 * 장애가 수신자 resolve를 10분간 "지갑 없음"으로 고정한다. 빈 결과는 실패
 * 쿨다운(10s)으로 강등해 레거시(매 시도 재조회)에 가깝게 동작시킨다.
 * (실제로 프로필이 없는 pubkey는 10초마다 재조회 — 레거시와 동일한 비용.)
 */
class EmptyProfileQueryResult extends Error {
  constructor() {
    super('empty profile query result')
  }
}

export class NostrGatewayAdapter implements NostrGateway {
  private pool: RelayPool
  private connectedRelays: Set<string> = new Set()
  private config: NostrGatewayConfig
  private readonly defaultTimeout: number
  private readonly reconnectIntervalMs: number

  // ─── Auto-reconnection state ───
  private activeSubscriptions = new Map<number, ActiveSubscription>()
  private nextSubId = 1
  private reconnectTimer: ReturnType<typeof setInterval> | null = null
  private wakeCleanup: (() => void) | null = null
  private targetRelays: string[] = []

  /** 6단계 위임 대상 (ks.nostr-controller OFF일 때만 존재) */
  private readonly controller: NostrSessionController | null
  /**
   * 10019/10050 프로필류 조회 병합 (설계 §10 B6) — TTL 10분 + in-flight 공유.
   * 스캔·SendInput·Contacts가 같은 수신자를 연달아 resolve할 때의 중복 REQ 제거.
   * 컨트롤러 경로 전용(ks ON이면 구동작).
   */
  private readonly profileQueryGate = new RequestGate({ cooldownMs: 10 * 60_000, failureCooldownMs: 10_000 })

  constructor(config: NostrGatewayConfig) {
    this.pool = createRelayPool()
    this.config = config
    this.defaultTimeout = config.defaultTimeout ?? 5000
    this.reconnectIntervalMs = config.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS
    this.controller = config.useSessionController
      ? new NostrSessionController({ reconnectIntervalMs: this.reconnectIntervalMs })
      : null
  }

  async connect(relays: string[]): Promise<void> {
    if (this.controller) {
      await this.controller.connectPersistent(relays)
      return
    }

    this.targetRelays = [...relays]

    for (const url of relays) {
      try {
        await this.connectRelay(url)
      } catch (error) {
        console.warn(`[NostrGateway] Failed to connect to ${url}:`, error)
      }
    }

    this.startAutoReconnect()
  }

  async disconnect(): Promise<void> {
    if (this.controller) {
      this.controller.disconnect()
      return
    }

    this.stopAutoReconnect()

    // Clean up all subscriptions
    for (const sub of this.activeSubscriptions.values()) {
      for (const cleanup of sub.cleanups) {
        try { cleanup() } catch { /* ignore */ }
      }
      sub.cleanups.clear()
    }
    this.activeSubscriptions.clear()

    this.pool.close(Array.from(this.connectedRelays))
    this.connectedRelays.clear()
    this.targetRelays = []
  }

  getRelayStatus(): RelayStatus[] {
    if (this.controller) {
      // persistent 집합 전체를 연결 여부와 함께 — RelayManagement 생존 표시의
      // 원천 (설계 §10 B6: raw WS 프로브 대체)
      return this.controller.getRelayStatus()
    }
    // 레거시 경로도 대상 집합 전체를 반환 (6단계 리뷰 minor #1): 연결된 것만
    // 반환하면 ks ON 폴백에서 RelayManagement의 미연결 표시(빨간 도트)가 공백이
    // 된다. 기존 소비자는 전부 `.filter(connected)`라 의미 변화 없음.
    const targets = this.targetRelays.length > 0 ? this.targetRelays : [...this.connectedRelays]
    return targets.map(url => ({
      url,
      connected: this.connectedRelays.has(url),
    }))
  }

  async publish(event: UnsignedNostrEvent): Promise<NostrEvent> {
    const signed = signEvent(event, this.config.privateKeyHex)

    if (this.controller) {
      const { ok } = await this.controller.publish(signed)
      if (ok.length === 0) {
        throw new Error('Failed to publish to any relay')
      }
      return signed
    }

    const relays = Array.from(this.connectedRelays)

    if (relays.length === 0) {
      throw new Error('No connected relays')
    }

    for (const relay of relays) {
      netLog({ layer: 'relay', op: 'publish', key: relay, detail: `kind:${signed.kind}`, caller: 'gateway' })
    }
    const results = await Promise.allSettled(this.pool.publish(relays, signed))
    const succeeded = results.filter(r => r.status === 'fulfilled').length

    if (succeeded === 0) {
      throw new Error('Failed to publish to any relay')
    }

    return signed
  }

  async queryEvents(filters: NostrFilter[]): Promise<NostrEvent[]> {
    if (this.controller) {
      return this.queryEventsViaController(filters)
    }

    const relays = Array.from(this.connectedRelays)
    if (relays.length === 0) return []

    const events: NostrEvent[] = []
    for (const filter of filters) {
      // key = 단일 relayUrl 계약 유지 (net-log 시그니처 파편화 방지 — 코드리뷰 #11)
      for (const relay of relays) {
        netLog({
          layer: 'relay',
          op: 'query',
          key: relay,
          detail: `kinds:${(filter.kinds ?? []).join('/')}${filter.since ? ` since:${filter.since}` : ''}`,
          caller: 'gateway',
        })
      }
      const results = await this.pool.querySync(
        relays,
        filter as Record<string, unknown>,
        { maxWait: this.defaultTimeout },
      )
      events.push(...(results as unknown as NostrEvent[]))
    }

    return events
  }

  private async queryEventsViaController(filters: NostrFilter[]): Promise<NostrEvent[]> {
    const relays = this.controller!.getConnectedPersistent()
    if (relays.length === 0) return []

    const events: NostrEvent[] = []
    for (const filter of filters) {
      const coalesceKey = profileCoalesceKey(filter)
      const run = async () => {
        for (const relay of relays) {
          netLog({
            layer: 'relay',
            op: 'query',
            key: relay,
            detail: `kinds:${(filter.kinds ?? []).join('/')}${filter.since ? ` since:${filter.since}` : ''}`,
            caller: 'gateway',
          })
        }
        const results = await this.controller!.querySync(
          relays,
          filter as Record<string, unknown>,
          { maxWait: this.defaultTimeout },
        )
        return results as unknown as NostrEvent[]
      }

      if (coalesceKey) {
        try {
          const { value } = await this.profileQueryGate.run(coalesceKey, async () => {
            const results = await run()
            if (results.length === 0) throw new EmptyProfileQueryResult()
            return results
          })
          events.push(...value)
        } catch (e) {
          if (!(e instanceof EmptyProfileQueryResult)) throw e
          // 빈 결과 — 캐시 없이 그대로 빈 배열 (호출자 계약 유지)
        }
      } else {
        events.push(...(await run()))
      }
    }

    return events
  }

  subscribe(
    filters: NostrFilter[],
    handler: (event: NostrEvent) => void,
  ): () => void {
    return this.subscribeInternal(filters, handler)
  }

  private subscribeInternal(
    filters: NostrFilter[],
    handler: (event: NostrEvent) => void,
    onEose?: (relayUrl: string) => void,
    eoseTimeoutMs?: number,
  ): () => void {
    if (this.controller) {
      // attach 보장 (설계 §10 B3/B4): (재)연결되는 relay에 자동 attach —
      // subscribe 시점 연결 스냅샷에만 붙던 레이스의 근본 수정
      return this.controller.subscribe(filters, handler, { onEose, eoseTimeoutMs })
    }

    const subId = this.nextSubId++
    const cleanups = new Set<() => void>()

    this.activeSubscriptions.set(subId, { filters, handler, cleanups, onEose, eoseTimeoutMs })
    this.subscribeToRelays(filters, handler, cleanups, onEose, eoseTimeoutMs)

    return () => {
      const sub = this.activeSubscriptions.get(subId)
      if (sub) {
        for (const cleanup of sub.cleanups) {
          try { cleanup() } catch { /* ignore */ }
        }
        this.activeSubscriptions.delete(subId)
      }
    }
  }

  async sendPrivateDirectMessage(params: DirectMessageParams): Promise<void> {
    const wrapped = wrapEvent(
      this.config.privateKeyHex,
      params.recipientPubkey,
      params.content,
    )

    if (this.controller) {
      // session lease (설계 §10 B3): 수신자 DM relay는 단명 연결 — 구경로의
      // connect(params.relays)는 persistent 재연결 대상을 통째로 교체했다
      const { ok } = await this.controller.publishScoped(params.relays, wrapped)
      if (ok.length === 0) {
        throw new Error('Failed to send direct message to any relay')
      }
      return
    }

    await this.connect(params.relays)

    const results = await Promise.allSettled(
      this.pool.publish(params.relays, wrapped),
    )
    const succeeded = results.filter(r => r.status === 'fulfilled').length

    if (succeeded === 0) {
      throw new Error('Failed to send direct message to any relay')
    }
  }

  async sendGiftWrap(params: GiftWrapParams): Promise<NostrEvent> {
    const wrapped = wrapEvent(
      this.config.privateKeyHex,
      params.recipientPubkey,
      params.content,
    )

    if (this.controller) {
      const { ok } = await this.controller.publishScoped(params.relays, wrapped)
      if (ok.length === 0) {
        throw new Error('Failed to publish gift wrap to any relay')
      }
      return wrapped
    }

    await this.connect(params.relays)

    const results = await Promise.allSettled(
      this.pool.publish(params.relays, wrapped),
    )
    const succeeded = results.filter(r => r.status === 'fulfilled').length

    if (succeeded === 0) {
      throw new Error('Failed to publish gift wrap to any relay')
    }

    return wrapped
  }

  async fetchGiftWraps(params: FetchGiftWrapsParams): Promise<UnwrappedMessage[]> {
    if (this.controller) {
      return this.fetchGiftWrapsViaController(params)
    }

    await this.connect(params.relays)

    // 캐치업 since (설계 §10 B5 2단계): 명시 override > cursor(lastFullSyncAtMs−Ω) > 없음.
    // cursor 계산 실패는 구독/조회를 막지 않는다 — 전체 창으로 폴백(유실 방지 우선).
    let since = params.sinceSecOverride
    if (since === undefined && params.cursor && !params.cursor.fullReplay && this.config.cursorStore) {
      try {
        const record = await this.config.cursorStore.load(params.cursor.key)
        since = sinceForCatchUp(record, params.cursor.overlapSec)
      } catch (error) {
        console.warn('[NostrGateway] Cursor load failed — full-window fetch:', error)
      }
    }

    const filter: Record<string, unknown> = {
      kinds: [1059],
      '#p': [params.recipientPubkey],
      ...(since !== undefined ? { since } : {}),
    }

    for (const relay of params.relays) {
      netLog({
        layer: 'relay',
        op: 'query',
        key: relay,
        detail: `kinds:1059${since !== undefined ? ` since:${since}` : ' full'}`,
        caller: 'gateway.giftwrap',
      })
    }

    const events = await this.pool.querySync(
      params.relays,
      filter,
      // full/deep 창은 5초로 드레인 불가 — 호출자가 상한을 지정한다 (리뷰 #3)
      { maxWait: params.maxWaitMs ?? this.defaultTimeout },
    )

    return this.unwrapAll(events as unknown as NostrEvent[])
  }

  /**
   * 캐치업 EOSE 엔진 경로 (설계 §10 B5 — 6단계): relay별 독립 REQ + relay별
   * since 창.
   *
   * - since(relay) = (relayEoseAtMs[relay] ?? lastFullSyncAtMs) − Ω [N1의 유일
   *   공식] — 단일 since(모든 relay에 lastFullSync 창)의 재다운로드를 relay별
   *   창으로 줄인다. D0/D10 반례(장기 다운 relay 복귀)는 그 relay의 오래된
   *   기준점이 그대로 창을 넓혀 회수한다.
   * - **cursor는 읽기 전용** — 마크(전진)는 settle 기계를 가진 라이브 구독이
   *   단일 소유한다. 캐치업이 반환 직후(처리 전) 마크하면 처리 중 크래시 시
   *   미처리 이벤트가 창 밖으로 밀리는 유실이 생긴다(2단계 리뷰 #4와 동일
   *   원리) — 단일 기록자 유지가 근본 해법이다.
   * - override(deep-resync)는 균일 창, fullReplay/cursor 없음은 전체 창.
   */
  private async fetchGiftWrapsViaController(params: FetchGiftWrapsParams): Promise<UnwrappedMessage[]> {
    const store = this.config.cursorStore
    const cursor = params.cursor

    let sinceFor: (relayUrl: string) => number | undefined
    if (params.sinceSecOverride !== undefined) {
      const uniform = params.sinceSecOverride
      sinceFor = () => uniform
    } else if (cursor && !cursor.fullReplay && store) {
      try {
        const record = await store.load(cursor.key)
        sinceFor = (relayUrl) => sinceForRelay(record, relayUrl, cursor.overlapSec)
      } catch (error) {
        console.warn('[NostrGateway] Cursor load failed — full-window fetch:', error)
        sinceFor = () => undefined
      }
    } else {
      sinceFor = () => undefined
    }

    const { events } = await this.controller!.collectUntilEose({
      relays: params.relays,
      filterFor: (relayUrl) => {
        const since = sinceFor(relayUrl)
        return {
          kinds: [1059],
          '#p': [params.recipientPubkey],
          ...(since !== undefined ? { since } : {}),
        } as NostrFilter
      },
      maxWaitMs: params.maxWaitMs ?? this.defaultTimeout,
      eoseGuardMs: CURSOR_EOSE_TIMEOUT_MS,
    })

    return this.unwrapAll(events)
  }

  private unwrapAll(events: NostrEvent[]): UnwrappedMessage[] {
    const messages: UnwrappedMessage[] = []
    for (const event of events) {
      // 캐치업 경로 계측 (설계 §12 배선 현황) — 라이브 구독 경로는 watcher가 계수
      incrementNetCounter('giftwrap_events_received')
      try {
        const unwrapped = unwrapEvent(event, this.config.privateKeyHex)
        messages.push({
          eventId: event.id,
          content: unwrapped.content,
          sender: unwrapped.sender,
        })
      } catch {
        // Not our message or decryption failed
      }
    }
    return messages
  }

  /**
   * Cursor 경로의 라이브 구독 (설계 §10 B5 — 2단계).
   *
   * - since: 단일값(lastFullSyncAtMs − Ω). fullReplay/최초(레코드 없음)면 미적용.
   * - 전진: T0 = 구독 확립 직전 wall clock.
   *     relay EOSE → markRelayEose(r, T0) (per-relay 이력 — 6단계 backfill 원천)
   *     구독 시점 스냅샷의 전(全) relay EOSE → markFullSync(T0)
   *     timeout/미완료는 markAttempt(T0)만 — 어떤 since 원천도 전진하지 않는다 [N1].
   * - cursor store 오류는 구독을 막지 않는다(전체 창 폴백 — 유실 방지 우선).
   * - 반환된 unsubscribe는 비동기 셋업(레코드 load) 완료 전에 불려도 안전하다.
   */
  private subscribeGiftWrapsWithCursor(
    baseFilter: NostrFilter,
    cursor: GiftwrapCursorSpec,
    store: GiftwrapCursorStore,
    handler: (msg: UnwrappedMessage) => void | Promise<void>,
  ): () => void {
    let closed = false
    let inner: (() => void) | null = null
    const t0 = Date.now()

    void (async () => {
      let since: number | undefined
      try {
        await store.markAttempt(cursor.key, t0)
        if (!cursor.fullReplay) {
          const record = await store.load(cursor.key)
          since = sinceForCatchUp(record, cursor.overlapSec)
        }
      } catch (error) {
        console.warn('[NostrGateway] Cursor setup failed — full-window subscribe:', error)
      }
      if (closed) return

      const filter: NostrFilter = since !== undefined ? { ...baseFilter, since } : baseFilter

      // 全EOSE(full-sync) 판정 기준 = **설정된 persistent relay 집합** (리뷰 #2).
      // 연결 스냅샷을 쓰면 다운/아직-미연결 relay가 조용히 빠져 사실상 quorum
      // 제외가 되고(§10 B5에서 2단계 금지), 그 relay 단독 이벤트가 창 밖으로
      // 밀려 유실된다. 미연결 target은 EOSE가 없으므로 cursor를 붙든다(안전).
      // targets 미지정이면 full-sync 마크 비활성 — EOSE 이력만 축적.
      const targets = new Set(cursor.fullSyncTargets ?? [])
      const eosed = new Set<string>()
      // 처리 중 크래시 대비: full-sync 마크는 EOSE 시점까지 도착한 이벤트들의
      // handler가 전부 settle된 뒤로 미룬다 (리뷰 #4 — pre-cursor의 "다음 세션
      // full replay가 재전달" 안전망을 창 안에서 보존).
      const inflightHandlers = new Set<Promise<unknown>>()
      let fullSyncQueued = false

      const queueFullSyncMark = () => {
        if (fullSyncQueued) return
        fullSyncQueued = true
        const pending = [...inflightHandlers]
        void Promise.allSettled(pending).then(() => {
          if (closed) return
          void store.markFullSync(cursor.key, t0).catch(() => {})
        })
      }

      inner = this.subscribeInternal(
        [filter],
        (event: NostrEvent) => {
          try {
            const unwrapped = unwrapEvent(event, this.config.privateKeyHex)
            const result = handler({
              eventId: event.id,
              content: unwrapped.content,
              sender: unwrapped.sender,
            })
            if (result instanceof Promise) {
              inflightHandlers.add(result)
              void result.finally(() => inflightHandlers.delete(result))
            }
          } catch {
            // Not our message or decryption failed
          }
        },
        (relayUrl) => {
          void store.markRelayEose(cursor.key, relayUrl, t0).catch(() => {})
          if (targets.has(relayUrl) && !eosed.has(relayUrl)) {
            eosed.add(relayUrl)
            if (targets.size > 0 && eosed.size === targets.size) {
              queueFullSyncMark()
            }
          }
        },
        // 합성 EOSE 차단 (리뷰 #1) — 진짜 EOSE만 cursor를 전진시킨다
        CURSOR_EOSE_TIMEOUT_MS,
      )

      if (closed) {
        inner()
        inner = null
      }
    })()

    return () => {
      closed = true
      if (inner) {
        inner()
        inner = null
      }
    }
  }

  subscribeGiftWraps(
    params: SubscribeGiftWrapsParams,
    handler: (msg: UnwrappedMessage) => void | Promise<void>,
  ): () => void {
    const baseFilter: NostrFilter = {
      kinds: [1059],
      '#p': [params.recipientPubkey],
      ...(params.since ? { since: params.since } : {}),
    }

    const store = this.config.cursorStore
    const cursor = params.cursor
    if (store && cursor) {
      return this.subscribeGiftWrapsWithCursor(baseFilter, cursor, store, handler)
    }

    return this.subscribe([baseFilter], (event: NostrEvent) => {
      try {
        const unwrapped = unwrapEvent(event, this.config.privateKeyHex)
        handler({
          eventId: event.id,
          content: unwrapped.content,
          sender: unwrapped.sender,
        })
      } catch {
        // Not our message or decryption failed — skip
      }
    })
  }

  // ─── Auto-reconnection internals ───

  private async connectRelay(url: string): Promise<void> {
    const relayPromise = this.pool.ensureRelay(url)
    relayPromise.catch(() => {})
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), RELAY_CONNECTION_TIMEOUT_MS),
    )

    await Promise.race([relayPromise, timeoutPromise])
    this.connectedRelays.add(url)
    netLog({ layer: 'relay', op: 'ws-open', key: url, detail: '', caller: 'gateway' })
  }

  private subscribeToRelays(
    filters: NostrFilter[],
    handler: (event: NostrEvent) => void,
    cleanups: Set<() => void>,
    onEose?: (relayUrl: string) => void,
    eoseTimeoutMs?: number,
  ): void {
    const relays = Array.from(this.connectedRelays)

    for (const filter of filters) {
      for (const relayUrl of relays) {
        this.pool.ensureRelay(relayUrl).then(relay => {
          // 연결이 실제로 확보된 뒤에만 기록 — 실패 relay의 유령 sub 방지 (코드리뷰 #11)
          netLog({
            layer: 'relay',
            op: 'sub',
            key: relayUrl,
            detail: `kinds:${(filter.kinds ?? []).join('/')}${filter.since ? ` since:${filter.since}` : ''}`,
            caller: 'gateway',
          })
          const sub = relay.subscribe(
            [filter as unknown as Record<string, unknown>],
            {
              onevent: (event) => handler(event as unknown as NostrEvent),
              ...(onEose
                ? {
                    oneose: () => {
                      netLog({ layer: 'relay', op: 'eose', key: relayUrl, detail: '', caller: 'gateway' })
                      onEose(relayUrl)
                    },
                  }
                : {}),
              ...(eoseTimeoutMs !== undefined ? { eoseTimeout: eoseTimeoutMs } : {}),
            },
          )
          cleanups.add(() => sub.close())
        }).catch(error => {
          console.warn(`[NostrGateway] Subscribe failed for ${relayUrl}:`, error)
        })
      }
    }
  }

  private startAutoReconnect(): void {
    if (this.reconnectTimer) return

    // Periodic health check
    this.reconnectTimer = setInterval(() => {
      this.runHealthCheck().catch(e =>
        console.warn('[NostrGateway] Health check failed:', e),
      )
    }, this.reconnectIntervalMs)

    // online + visibility(visible) → 디바운스된 단일 헬스체크 (설계 §10 B7 1단계 선반영).
    // 기존에는 두 이벤트가 각자 즉시 runHealthCheck를 호출해, 포그라운드 전환·네트워크
    // 플래핑 시 백투백 헬스체크(+전 구독 재오픈 가능성)가 발생했다.
    const cleanups: Array<() => void> = []
    cleanups.push(
      onWake(() => {
        console.log('[NostrGateway] Wake — health check')
        this.runHealthCheck().catch(() => {})
      }),
    )
    if (typeof window !== 'undefined') {
      const handleOffline = () => console.log('[NostrGateway] Offline')
      window.addEventListener('offline', handleOffline)
      cleanups.push(() => window.removeEventListener('offline', handleOffline))
    }
    this.wakeCleanup = () => {
      for (const cleanup of cleanups) cleanup()
    }
  }

  private stopAutoReconnect(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.wakeCleanup) {
      this.wakeCleanup()
      this.wakeCleanup = null
    }
  }

  private async runHealthCheck(): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return

    // Prune relays that are no longer connected
    for (const url of this.connectedRelays) {
      try {
        const relay = await this.pool.ensureRelay(url)
        if (!relay.connected) {
          this.connectedRelays.delete(url)
        }
      } catch {
        this.connectedRelays.delete(url)
      }
    }

    let reconnected = false

    for (const url of this.targetRelays) {
      if (!this.connectedRelays.has(url)) {
        try {
          await this.connectRelay(url)
          reconnected = true
          console.log(`[NostrGateway] Reconnected to ${url}`)
        } catch {
          // Will retry next cycle
        }
      }
    }

    // Re-subscribe on reconnected relays
    if (reconnected && this.activeSubscriptions.size > 0) {
      for (const sub of this.activeSubscriptions.values()) {
        // Close old cleanups
        for (const cleanup of sub.cleanups) {
          try { cleanup() } catch { /* ignore */ }
        }
        sub.cleanups.clear()
        // Re-subscribe on all connected relays
        this.subscribeToRelays(sub.filters, sub.handler, sub.cleanups, sub.onEose, sub.eoseTimeoutMs)
      }
      console.log(`[NostrGateway] Re-subscribed ${this.activeSubscriptions.size} subscriptions`)
    }
  }
}
