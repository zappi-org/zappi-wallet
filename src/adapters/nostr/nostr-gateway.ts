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
  UnwrappedMessage,
} from '@/core/ports/driven/nostr-gateway.port'
import type { NostrEvent, NostrFilter, UnsignedNostrEvent } from '@/core/domain/nostr'
import { signEvent, wrapEvent, unwrapEvent } from './internal/nostr-crypto'
import { createRelayPool, type RelayPool } from './internal/nostr-relay'
import { onWake } from '@/core/utils/wake-signal'
import { netLog } from '@/core/utils/net-log'

export interface NostrGatewayConfig {
  privateKeyHex: string
  defaultTimeout?: number
  reconnectIntervalMs?: number
}

// ─── Internal types ───

interface ActiveSubscription {
  filters: NostrFilter[]
  handler: (event: NostrEvent) => void
  cleanups: Set<() => void>
}

const DEFAULT_RECONNECT_INTERVAL_MS = 30_000
const RELAY_CONNECTION_TIMEOUT_MS = 5_000

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
    const subId = this.nextSubId++
    const cleanups = new Set<() => void>()

    this.activeSubscriptions.set(subId, { filters, handler, cleanups })
    this.subscribeToRelays(filters, handler, cleanups)

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

    const events = await this.pool.querySync(
      params.relays,
      { kinds: [1059], '#p': [params.recipientPubkey] },
      { maxWait: this.defaultTimeout },
    )

    const messages: UnwrappedMessage[] = []
    for (const event of events) {
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

  subscribeGiftWraps(
    params: SubscribeGiftWrapsParams,
    handler: (msg: UnwrappedMessage) => void,
  ): () => void {
    const filter: NostrFilter = {
      kinds: [1059],
      '#p': [params.recipientPubkey],
      ...(params.since ? { since: params.since } : {}),
    }

    return this.subscribe([filter], (event: NostrEvent) => {
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
        this.subscribeToRelays(sub.filters, sub.handler, sub.cleanups)
      }
      console.log(`[NostrGateway] Re-subscribed ${this.activeSubscriptions.size} subscriptions`)
    }
  }
}
