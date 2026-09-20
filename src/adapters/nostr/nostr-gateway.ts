/**
 * NostrGatewayAdapter — NostrGateway port implementation.
 *
 * Handles relay communication only. Local operations (signing, encryption) come from
 * internal/nostr-crypto.ts; relay pool management from internal/nostr-relay.ts.
 * Never imports nostr-tools directly — only via internal/.
 *
 * Auto-reconnect: after connect(), detects relay drops and restores subscriptions.
 * Also reacts to network online/offline and document visibility changes.
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
   * Gift wrap since-cursor store. Injected by bootstrap only when the `ks.cursor`
   * kill-switch is off — if absent, the cursor spec is ignored and behavior falls
   * back to full replay.
   */
  cursorStore?: GiftwrapCursorStore
  /**
   * Delegate to SessionController. Set by bootstrap only when the
   * `ks.nostr-controller` kill-switch is off — if false, the legacy
   * connect/subscribe/reconnect path in this file is used.
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
 * EOSE guard for cursor subscriptions. When a relay never sends EOSE, nostr-tools
 * fires a **synthetic EOSE** through the same callback after baseEoseTimeout (4400ms).
 * A relay still streaming its backlog would then get recorded as "done", corrupting
 * lastFullSyncAtMs and pushing unreceived events outside the next session window
 * (silent loss). Setting this effectively infinite means only a real EOSE advances
 * the cursor. A pin test watches the library default.
 */
export const CURSOR_EOSE_TIMEOUT_MS = 24 * 60 * 60 * 1000

/**
 * Coalesce key for single-author profile-type lookups (10019 nutzap-info /
 * 10050 DM relay list). A single replaceable-event query returns the same answer
 * within 10 min, so this dedupes the scan→SendInput→confirm flow resolving the same
 * recipient back-to-back.
 */
function profileCoalesceKey(filter: NostrFilter): string | null {
  const kinds = filter.kinds ?? []
  const authors = filter.authors ?? []
  if (kinds.length !== 1 || authors.length !== 1) return null
  if (kinds[0] !== 10019 && kinds[0] !== 10050) return null
  return `${kinds[0]}:${authors[0]}`
}

/**
 * Marker for an empty profile query result: querySync never rejects — it returns []
 * even on relay flake or drain failure. Caching [] as a 10-min success would pin a
 * recipient's resolve to "no wallet" for 10 min during a transient outage. Treating an
 * empty result as a failure (10s cooldown) keeps behavior close to legacy (re-query
 * every attempt); a genuinely profileless pubkey is re-queried every 10s.
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

  /** Delegation target — present only when ks.nostr-controller is OFF. */
  private readonly controller: NostrSessionController | null
  /**
   * Coalesces 10019/10050 profile-type lookups — 10-min TTL + in-flight sharing.
   * Removes duplicate REQs when scan / SendInput / Contacts resolve the same recipient
   * back-to-back. Controller path only (legacy behavior when ks is ON).
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
      // Whole persistent set with connection status — source for RelayManagement's
      // liveness display (replaces raw WS probing).
      return this.controller.getRelayStatus()
    }
    // Legacy path also returns the whole target set: returning only connected relays
    // would blank out RelayManagement's disconnected (red-dot) indicator in the ks-ON
    // fallback. Existing consumers all `.filter(connected)`, so no semantic change.
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
      // key = single relayUrl to hold the contract (avoids net-log signature fragmentation)
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
          // Empty result — return empty array without caching (preserves caller contract)
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
      // Guarantees attach: auto-attaches to (re)connecting relays — fixes the race
      // where a subscription only bound to the connection snapshot at subscribe time.
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
      // Session lease: recipient DM relays are short-lived connections — the old
      // connect(params.relays) replaced the entire persistent reconnect target set.
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

    // Catch-up since precedence: explicit override > cursor(lastFullSyncAtMs−Ω) > none.
    // A cursor computation failure never blocks the fetch — fall back to the full
    // window (loss prevention first).
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
      // full/deep windows can't drain in 5s — the caller specifies the cap
      { maxWait: params.maxWaitMs ?? this.defaultTimeout },
    )

    return this.unwrapAll(events as unknown as NostrEvent[])
  }

  /**
   * Catch-up EOSE engine path: independent REQ per relay + per-relay since window.
   *
   * - since(relay) = (relayEoseAtMs[relay] ?? lastFullSyncAtMs) − Ω, the sole formula.
   *   Shrinks the re-download of a single since (a lastFullSync window for every relay)
   *   to a per-relay window. A long-down relay returning still recovers, since its stale
   *   baseline widens that relay's window.
   * - **cursor is read-only** here — advancing (marking) is owned solely by the live
   *   subscription, which has the settle machinery. Marking right after catch-up returns
   *   (before processing) would lose unprocessed events past the window on a processing
   *   crash; a single writer is the real fix.
   * - override (deep-resync) uses a uniform window; no fullReplay/cursor means the full window.
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
      // Catch-up path instrumentation — the live subscription path is counted by the watcher
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
   * Live subscription for the cursor path.
   *
   * - since: single value (lastFullSyncAtMs − Ω). Not applied on fullReplay or first
   *   run (no record).
   * - Advancing: T0 = wall clock just before the subscription is established.
   *     relay EOSE → markRelayEose(r, T0) (per-relay history — source for backfill)
   *     EOSE from every relay in the subscribe-time snapshot → markFullSync(T0)
   *     timeout/incomplete → markAttempt(T0) only; no since source advances.
   * - A cursor store error never blocks the subscription (full-window fallback —
   *   loss prevention first).
   * - The returned unsubscribe is safe to call before async setup (record load) finishes.
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

      // Full-sync is judged against the **configured persistent relay set**. Using the
      // connection snapshot would silently drop down / not-yet-connected relays,
      // effectively excluding them from quorum, and their relay-only events would fall
      // outside the window and be lost. An unconnected target sends no EOSE, so it holds
      // the cursor back (safe). With no targets, full-sync marking is disabled — only
      // EOSE history accumulates.
      const targets = new Set(cursor.fullSyncTargets ?? [])
      const eosed = new Set<string>()
      // Crash-during-processing guard: defer the full-sync mark until every handler for
      // events that arrived by EOSE has settled (preserves the pre-cursor "next session's
      // full replay re-delivers" safety net within the window).
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
        // Block synthetic EOSE — only a real EOSE advances the cursor
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
          // Log only after the connection is actually established — avoids ghost subs for failed relays
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

    this.reconnectTimer = setInterval(() => {
      this.runHealthCheck().catch(e =>
        console.warn('[NostrGateway] Health check failed:', e),
      )
    }, this.reconnectIntervalMs)

    // online + visibility(visible) → a single debounced health check. Previously both
    // events each called runHealthCheck immediately, causing back-to-back checks (and a
    // possible full re-subscribe) on foreground switches or network flapping.
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

    if (reconnected && this.activeSubscriptions.size > 0) {
      for (const sub of this.activeSubscriptions.values()) {
        for (const cleanup of sub.cleanups) {
          try { cleanup() } catch { /* ignore */ }
        }
        sub.cleanups.clear()
        this.subscribeToRelays(sub.filters, sub.handler, sub.cleanups, sub.onEose, sub.eoseTimeoutMs)
      }
      console.log(`[NostrGateway] Re-subscribed ${this.activeSubscriptions.size} subscriptions`)
    }
  }
}
