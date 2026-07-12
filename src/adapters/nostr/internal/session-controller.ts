/**
 * NostrSessionController — single owner of relay connection lifecycle,
 * subscriptions, and query/publish scope.
 *
 * Owns: persistent/session connection registries, subscription attach guarantee,
 * reconnection, EOSE collection engine (catch-up), onWake reaction.
 * Does not own: gift wrap interpretation (watcher), cursor semantics (gateway
 * computes via domain functions), anchor/transaction creation.
 *
 * Faults fixed vs the old path:
 * - Subscriptions bound only to relays connected at subscribe() time and never
 *   to later (re)connections → now every (re)connected relay attaches all
 *   subscriptions targeting it.
 * - One reconnect closed and reopened all subs × all relays (churn) → only the
 *   affected relay resumes.
 * - DM send's connect(recipient relays) replaced the whole persistent reconnect
 *   set → isolated via session lease (refcount+TTL), persistent set stays fixed.
 *
 * URL identity: every internal registry key goes through the same normalization
 * (relayIdentity) as the pool — otherwise a variant spelling of a recipient's
 * 10050 slips past identity checks and lease expiry closes a shared persistent
 * socket. Display/query URLs preserve the caller's original form (matching
 * settings-screen keys).
 */

import type { NostrEvent, NostrFilter } from '@/core/domain/nostr'
import type { RelayStatus } from '@/core/ports/driven/nostr-gateway.port'
import { createRelayPool, relayIdentity, type Relay, type RelayPool } from './nostr-relay'
import { onWake } from '@/core/utils/wake-signal'
import { netLog } from '@/core/utils/net-log'

const DEFAULT_RECONNECT_INTERVAL_MS = 30_000
const RELAY_CONNECTION_TIMEOUT_MS = 5_000
/** Default session lease TTL — includes slack for awaiting publish OK (60s is too tight) */
const SESSION_LEASE_TTL_MS = 120_000

interface RegisteredSubscription {
  filters: NostrFilter[]
  onEvent: (event: NostrEvent) => void
  onEose?: (relayUrl: string) => void
  eoseTimeoutMs?: number
  /** relay identity (normalized key) → live sub handle; the attach-guarantee ledger */
  attached: Map<string, { close: () => void }>
}

interface SessionLease {
  refs: number
  closeTimer: ReturnType<typeof setTimeout> | null
  /** Original URL for pool calls */
  url: string
}

export class NostrSessionController {
  private readonly pool: RelayPool
  private readonly reconnectIntervalMs: number

  /** Persistent set — original URLs (for display/pool calls); identities in persistentIds */
  private persistentTargets: string[] = []
  private persistentIds = new Set<string>()
  /** Connection ledger — normalized keys */
  private connected = new Set<string>()

  /** Session relays (recipient DM relays, etc.) — normalized keys; receive no subscriptions */
  private sessionLeases = new Map<string, SessionLease>()

  private subs = new Map<number, RegisteredSubscription>()
  private nextSubId = 1

  private reconnectTimer: ReturnType<typeof setInterval> | null = null
  private wakeCleanup: (() => void) | null = null

  constructor(opts?: { reconnectIntervalMs?: number; pool?: RelayPool }) {
    this.pool = opts?.pool ?? createRelayPool()
    this.reconnectIntervalMs = opts?.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS
  }

  // ─── Connection registry ───

  /**
   * Establish/replace the persistent set. Removed relays are detached and closed
   * (unless an active session lease holds them — then lease expiry closes them).
   * Connections run in parallel so a slow relay can't serialize/block unlock.
   */
  async connectPersistent(urls: string[]): Promise<void> {
    const nextByIdentity = new Map<string, string>()
    for (const url of urls) {
      const id = relayIdentity(url)
      if (!nextByIdentity.has(id)) nextByIdentity.set(id, url)
    }

    const removed = this.persistentTargets.filter(
      (u) => !nextByIdentity.has(relayIdentity(u)),
    )
    this.persistentTargets = [...nextByIdentity.values()]
    this.persistentIds = new Set(nextByIdentity.keys())

    for (const url of removed) {
      const id = relayIdentity(url)
      this.detachSubsFrom(id)
      if (!this.sessionLeases.has(id)) {
        this.closeRelay(url)
      }
    }

    await Promise.allSettled(this.persistentTargets.map((url) => this.connectAndAttach(url)))
    this.startLifecycle()
  }

  /**
   * Session lease: a short-lived connection to a relay outside the persistent
   * set. Call release() after publish confirmation — once refs hit 0 the relay
   * closes after TTL. When persistent and session overlap the lease is a no-op
   * (expiry never closes a persistent connection).
   */
  async acquireSession(urls: string[], ttlMs = SESSION_LEASE_TTL_MS): Promise<{ release(): void }> {
    const sessionEntries: Array<{ id: string; url: string }> = []
    const seen = new Set<string>()
    for (const url of urls) {
      const id = relayIdentity(url)
      if (seen.has(id) || this.persistentIds.has(id)) continue
      seen.add(id)
      sessionEntries.push({ id, url })
    }

    for (const { id, url } of sessionEntries) {
      const lease = this.sessionLeases.get(id) ?? { refs: 0, closeTimer: null, url }
      lease.refs++
      if (lease.closeTimer) {
        clearTimeout(lease.closeTimer)
        lease.closeTimer = null
      }
      this.sessionLeases.set(id, lease)
    }

    await Promise.allSettled(sessionEntries.map(({ url }) => this.connectRelay(url)))

    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        for (const { id } of sessionEntries) {
          const lease = this.sessionLeases.get(id)
          if (!lease) continue
          lease.refs--
          if (lease.refs <= 0) {
            lease.closeTimer = setTimeout(() => {
              const current = this.sessionLeases.get(id)
              if (!current || current.refs > 0) return
              this.sessionLeases.delete(id)
              // Don't close if it was promoted to persistent in the meantime
              if (!this.persistentIds.has(id)) {
                this.closeRelay(current.url)
              }
            }, ttlMs)
          }
        }
      },
    }
  }

  disconnect(): void {
    this.stopLifecycle()
    for (const sub of this.subs.values()) {
      for (const handle of sub.attached.values()) {
        try { handle.close() } catch { /* ignore */ }
      }
      sub.attached.clear()
    }
    this.subs.clear()
    const sessionUrls = [...this.sessionLeases.values()].map((l) => l.url)
    for (const lease of this.sessionLeases.values()) {
      if (lease.closeTimer) clearTimeout(lease.closeTimer)
    }
    this.sessionLeases.clear()
    this.pool.close([...this.persistentTargets, ...sessionUrls])
    this.connected.clear()
    this.persistentTargets = []
    this.persistentIds = new Set()
  }

  getRelayStatus(): RelayStatus[] {
    // Return original URLs — must match the RelayManagement screen's settings keys
    return this.persistentTargets.map((url) => ({
      url,
      connected: this.connected.has(relayIdentity(url)),
    }))
  }

  /** publish/query targets — connected persistent relays only (session is explicit-path only) */
  getConnectedPersistent(): string[] {
    return this.persistentTargets.filter((u) => this.connected.has(relayIdentity(u)))
  }

  // ─── Subscription registry ───

  /**
   * Subscribe against the persistent set. Attaches immediately to currently
   * connected persistent relays and auto-attaches to any that (re)connect later
   * — the root fix for the old race that bound only to the connection snapshot
   * at subscribe() time.
   */
  subscribe(
    filters: NostrFilter[],
    onEvent: (event: NostrEvent) => void,
    opts?: { onEose?: (relayUrl: string) => void; eoseTimeoutMs?: number },
  ): () => void {
    const id = this.nextSubId++
    const sub: RegisteredSubscription = {
      filters,
      onEvent,
      onEose: opts?.onEose,
      eoseTimeoutMs: opts?.eoseTimeoutMs,
      attached: new Map(),
    }
    this.subs.set(id, sub)

    for (const url of this.getConnectedPersistent()) {
      this.attachSubTo(sub, url)
    }

    return () => {
      const registered = this.subs.get(id)
      if (!registered) return
      for (const handle of registered.attached.values()) {
        try { handle.close() } catch { /* ignore */ }
      }
      registered.attached.clear()
      this.subs.delete(id)
    }
  }

  // ─── Query/publish scope ───

  /** Publish to connected persistent relays */
  async publish(event: unknown): Promise<{ ok: string[]; failed: string[] }> {
    const relays = this.getConnectedPersistent()
    return this.publishTo(relays, event)
  }

  /** Publish to explicit relays — acquires a session lease, releases after confirmation */
  async publishScoped(relays: string[], event: unknown): Promise<{ ok: string[]; failed: string[] }> {
    const lease = await this.acquireSession(relays)
    try {
      return await this.publishTo(relays, event)
    } finally {
      lease.release()
    }
  }

  private async publishTo(relays: string[], event: unknown): Promise<{ ok: string[]; failed: string[] }> {
    if (relays.length === 0) return { ok: [], failed: [] }
    for (const relay of relays) {
      netLog({ layer: 'relay', op: 'publish', key: relay, detail: '', caller: 'controller' })
    }
    const results = await Promise.allSettled(this.pool.publish(relays, event))
    const ok: string[] = []
    const failed: string[] = []
    results.forEach((r, i) => (r.status === 'fulfilled' ? ok : failed).push(relays[i]))
    return { ok, failed }
  }

  async querySync(
    relays: string[],
    filter: Record<string, unknown>,
    opts?: { maxWait?: number },
  ): Promise<unknown[]> {
    return this.pool.querySync(relays, filter, opts)
  }

  // ─── EOSE collection engine — per-relay wiring for catch-up ───

  /**
   * Collect until a real EOSE via an independent REQ per relay. Unlike querySync
   * (a timeout drain), this exposes how far each relay delivered — the premise
   * for per-relay cursor advancement.
   *
   * - filterFor(relay): per-relay filter carrying `since` (caller computes it
   *   from domain rules)
   * - each relay ends on a real EOSE (synthetic ones blocked via eoseTimeout) or
   *   at maxWaitMs
   * - the connect itself is also capped at 5s: on a black-hole network an
   *   unbounded ensureRelay would hang catch-up, and the isSyncing lock would
   *   then block later syncs too
   * - returns: id-deduped events + the relays that reached a real EOSE
   */
  async collectUntilEose(params: {
    relays: string[]
    filterFor: (relayUrl: string) => NostrFilter
    maxWaitMs: number
    /** Synthetic-EOSE guard — must exceed the gateway's CURSOR_EOSE_TIMEOUT_MS */
    eoseGuardMs: number
  }): Promise<{ events: NostrEvent[]; eosed: string[] }> {
    const lease = await this.acquireSession(params.relays)
    const byId = new Map<string, NostrEvent>()
    const eosed: string[] = []

    try {
      await Promise.allSettled(
        params.relays.map(async (url) => {
          const relay = await this.ensureRelayWithTimeout(url)
          const filter = params.filterFor(url)
          netLog({
            layer: 'relay',
            op: 'query',
            key: url,
            detail: `kinds:${(filter.kinds ?? []).join('/')}${filter.since ? ` since:${filter.since}` : ' full'}`,
            caller: 'controller.eose',
          })
          await new Promise<void>((resolve) => {
            let done = false
            const finish = () => {
              if (done) return
              done = true
              clearTimeout(cap)
              try { sub.close() } catch { /* ignore */ }
              resolve()
            }
            const cap = setTimeout(finish, params.maxWaitMs)
            const sub = relay.subscribe([filter as unknown as Record<string, unknown>], {
              onevent: (event) => {
                const ev = event as unknown as NostrEvent
                if (!byId.has(ev.id)) byId.set(ev.id, ev)
              },
              oneose: () => {
                netLog({ layer: 'relay', op: 'eose', key: url, detail: '', caller: 'controller.eose' })
                eosed.push(url)
                finish()
              },
              eoseTimeout: params.eoseGuardMs,
            })
          })
        }),
      )
    } finally {
      lease.release()
    }

    return { events: [...byId.values()], eosed }
  }

  // ─── Internal: attach guarantee + reconnect ───

  /**
   * Enforces a connection cap: without a timeout option AbstractRelay.connect
   * has no timeout handle at all — on a black-hole network (captive portal) the
   * pending connect lingers forever. Every ensureRelay use goes through this helper.
   */
  private async ensureRelayWithTimeout(url: string): Promise<Relay> {
    const relayPromise = this.pool.ensureRelay(url)
    relayPromise.catch(() => {})
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Connection timeout')), RELAY_CONNECTION_TIMEOUT_MS),
    )
    return Promise.race([relayPromise, timeout])
  }

  private async connectAndAttach(url: string): Promise<void> {
    await this.connectRelay(url)
    this.attachSubscriptionsTo(url)
  }

  private async connectRelay(url: string): Promise<void> {
    await this.ensureRelayWithTimeout(url)
    this.connected.add(relayIdentity(url))
    netLog({ layer: 'relay', op: 'ws-open', key: url, detail: '', caller: 'controller' })
  }

  private closeRelay(url: string): void {
    this.pool.close([url])
    this.connected.delete(relayIdentity(url))
  }

  /** Attach all registered subscriptions to a (re)connected relay — no-op if already attached */
  private attachSubscriptionsTo(url: string): void {
    for (const sub of this.subs.values()) {
      this.attachSubTo(sub, url)
    }
  }

  private attachSubTo(sub: RegisteredSubscription, url: string): void {
    const id = relayIdentity(url)
    if (sub.attached.has(id)) return
    // Reserve the slot — prevents a duplicate attach before ensureRelay resolves
    sub.attached.set(id, { close: () => {} })
    this.ensureRelayWithTimeout(url)
      .then((relay) => {
        // If unsubscribe already ran (removed from attached), don't attach
        if (!sub.attached.has(id)) return
        for (const filter of sub.filters) {
          netLog({
            layer: 'relay',
            op: 'sub',
            key: url,
            detail: `kinds:${(filter.kinds ?? []).join('/')}${filter.since ? ` since:${filter.since}` : ''}`,
            caller: 'controller',
          })
        }
        // Distinguish an intentional close (our detach/unsubscribe) from a
        // relay-side close (CLOSED / dead socket) — the latter is dropped from
        // the ledger so the next health check re-attaches. If ensureRelay
        // silently revives a dead socket, watching the socket can't reveal the
        // lost subscription, so the subscription's own close signal is the only
        // trustworthy source.
        let intentionalClose = false
        const inner = relay.subscribe(
          // Don't share the filters reference across per-relay Subscriptions —
          // the library only stores them, but a shallow clone forecloses any
          // mutation path
          sub.filters.map((f) => ({ ...f })) as unknown as Array<Record<string, unknown>>,
          {
            onevent: (event) => sub.onEvent(event as unknown as NostrEvent),
            ...(sub.onEose
              ? {
                  oneose: () => {
                    netLog({ layer: 'relay', op: 'eose', key: url, detail: '', caller: 'controller' })
                    sub.onEose?.(url)
                  },
                }
              : {}),
            onclose: () => {
              if (intentionalClose) return
              const current = sub.attached.get(id)
              if (current === handle) {
                sub.attached.delete(id)
              }
            },
            ...(sub.eoseTimeoutMs !== undefined ? { eoseTimeout: sub.eoseTimeoutMs } : {}),
          },
        )
        const handle = {
          close: () => {
            intentionalClose = true
            try { inner.close() } catch { /* ignore */ }
          },
        }
        // Re-check the unsubscribe race — don't leave a live handle in a closed slot
        if (!sub.attached.has(id)) {
          handle.close()
          return
        }
        sub.attached.set(id, handle)
      })
      .catch((error) => {
        // Drop the failed slot reservation — the next health check/reconnect retries
        sub.attached.delete(id)
        console.warn(`[SessionController] attach failed for ${url}:`, error)
      })
  }

  private detachSubsFrom(relayId: string): void {
    for (const sub of this.subs.values()) {
      const handle = sub.attached.get(relayId)
      if (handle) {
        try { handle.close() } catch { /* ignore */ }
        sub.attached.delete(relayId)
      }
    }
  }

  private startLifecycle(): void {
    if (this.reconnectTimer) return
    this.reconnectTimer = setInterval(() => {
      this.runHealthCheck().catch((e) => console.warn('[SessionController] health check failed:', e))
    }, this.reconnectIntervalMs)
    this.wakeCleanup = onWake(() => {
      this.runHealthCheck().catch(() => {})
    })
  }

  private stopLifecycle(): void {
    if (this.reconnectTimer) {
      clearInterval(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.wakeCleanup) {
      this.wakeCleanup()
      this.wakeCleanup = null
    }
  }

  /**
   * Detect and reconnect only dead relays, and attach **only that relay** —
   * dropping the old path's "one reconnect → reopen all subs × all relays" churn.
   */
  private async runHealthCheck(): Promise<void> {
    if (typeof navigator !== 'undefined' && !navigator.onLine) return

    for (const url of this.persistentTargets) {
      const id = relayIdentity(url)
      if (!this.connected.has(id)) continue
      try {
        const relay = await this.ensureRelayWithTimeout(url)
        if (!relay.connected) {
          this.connected.delete(id)
          this.detachSubsFrom(id)
        }
      } catch {
        this.connected.delete(id)
        this.detachSubsFrom(id)
      }
    }

    for (const url of this.persistentTargets) {
      if (!this.connected.has(relayIdentity(url))) {
        try {
          await this.connectAndAttach(url)
          console.log(`[SessionController] Reconnected ${url}`)
        } catch {
          // Retry on the next cycle/wake
        }
      }
    }

    // Backfill subscriptions that dropped from the ledger via a relay-side close
    // while the connection is still alive (including when ensureRelay silently
    // revived it) — this pairs with the onclose signal.
    for (const url of this.persistentTargets) {
      if (this.connected.has(relayIdentity(url))) {
        this.attachSubscriptionsTo(url)
      }
    }
  }
}
