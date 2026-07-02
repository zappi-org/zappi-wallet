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
import { sinceForCatchUp } from '@/core/domain/giftwrap-cursor'
import type { NostrEvent, NostrFilter, UnsignedNostrEvent } from '@/core/domain/nostr'
import { signEvent, wrapEvent, unwrapEvent } from './internal/nostr-crypto'
import { createRelayPool, type RelayPool } from './internal/nostr-relay'
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

  constructor(config: NostrGatewayConfig) {
    this.pool = createRelayPool()
    this.config = config
    this.defaultTimeout = config.defaultTimeout ?? 5000
    this.reconnectIntervalMs = config.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS
  }

  async connect(relays: string[]): Promise<void> {
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
    return Array.from(this.connectedRelays).map(url => ({
      url,
      connected: true,
    }))
  }

  async publish(event: UnsignedNostrEvent): Promise<NostrEvent> {
    const signed = signEvent(event, this.config.privateKeyHex)
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

    const messages: UnwrappedMessage[] = []
    for (const event of events) {
      // 캐치업 경로 계측 (설계 §12 배선 현황) — 라이브 구독 경로는 watcher가 계수
      incrementNetCounter('giftwrap_events_received')
      try {
        const unwrapped = unwrapEvent(
          event as unknown as NostrEvent,
          this.config.privateKeyHex,
        )
        messages.push({
          eventId: (event as unknown as NostrEvent).id,
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
