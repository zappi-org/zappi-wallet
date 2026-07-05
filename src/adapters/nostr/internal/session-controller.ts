/**
 * NostrSessionController — relay 연결 수명·구독·조회/발행 스코프의 단일 소유자
 * (설계 §9/§10 B2~B4·B6 — 6단계, ks.nostr-controller OFF에서 gateway가 위임)
 *
 * 소유: persistent/session 연결 레지스트리, 구독 attach 보장, 재연결,
 *       EOSE 수집 엔진(catch-up), onWake 반응.
 * 비소유: gift wrap 해석(watcher), cursor 의미론(gateway가 도메인 함수로 계산),
 *         anchor·거래 생성.
 *
 * 구경로 대비 고치는 결함:
 * - 구독이 subscribe 시점에 연결된 relay에만 붙고 이후 (재)연결엔 안 붙던 레이스
 *   → relay가 (재)연결될 때 그 relay를 대상으로 하는 모든 구독을 attach.
 * - 재연결 1건에 전 구독×전 relay를 닫고 재오픈하던 churn → 해당 relay만 재개.
 * - DM 발송의 connect(수신자 relays)가 persistent 재연결 대상을 통째로 교체하던
 *   버그 → session lease(refcount+TTL)로 격리, persistent 집합 불변.
 *
 * URL 정체성 (리뷰 #4): 내부 레지스트리 키는 전부 pool과 동일한 정규화
 * (relayIdentity)를 거친다 — 다르면 수신자 10050의 변형 표기가 [N9] 검사를
 * 빠져나가 lease 만료가 공유 persistent 소켓을 닫는다. 표시/조회용 URL은
 * 호출자가 준 원형을 보존한다(설정 화면 키와의 일치).
 */

import type { NostrEvent, NostrFilter } from '@/core/domain/nostr'
import type { RelayStatus } from '@/core/ports/driven/nostr-gateway.port'
import { createRelayPool, relayIdentity, type Relay, type RelayPool } from './nostr-relay'
import { onWake } from '@/core/utils/wake-signal'
import { netLog } from '@/core/utils/net-log'

const DEFAULT_RECONNECT_INTERVAL_MS = 30_000
const RELAY_CONNECTION_TIMEOUT_MS = 5_000
/** session lease 기본 TTL — publish OK 대기 여유 포함 (설계 §10 B3: 60s는 위험) */
const SESSION_LEASE_TTL_MS = 120_000

interface RegisteredSubscription {
  filters: NostrFilter[]
  onEvent: (event: NostrEvent) => void
  onEose?: (relayUrl: string) => void
  eoseTimeoutMs?: number
  /** relay 정체성(정규화 키) → 살아있는 sub 핸들. attach 보장의 원장. */
  attached: Map<string, { close: () => void }>
}

interface SessionLease {
  refs: number
  closeTimer: ReturnType<typeof setTimeout> | null
  /** pool 호출용 원형 URL */
  url: string
}

export class NostrSessionController {
  private readonly pool: RelayPool
  private readonly reconnectIntervalMs: number

  /** persistent 집합 — 원형 URL (표시·pool 호출용). 정체성은 persistentIds. */
  private persistentTargets: string[] = []
  private persistentIds = new Set<string>()
  /** 연결 장부 — 정규화 키 */
  private connected = new Set<string>()

  /** session relay(수신자 DM relay 등) — 정규화 키, 구독을 받지 않는다 */
  private sessionLeases = new Map<string, SessionLease>()

  private subs = new Map<number, RegisteredSubscription>()
  private nextSubId = 1

  private reconnectTimer: ReturnType<typeof setInterval> | null = null
  private wakeCleanup: (() => void) | null = null

  constructor(opts?: { reconnectIntervalMs?: number; pool?: RelayPool }) {
    this.pool = opts?.pool ?? createRelayPool()
    this.reconnectIntervalMs = opts?.reconnectIntervalMs ?? DEFAULT_RECONNECT_INTERVAL_MS
  }

  // ─── 연결 레지스트리 (B3) ───

  /**
   * persistent 집합 확립/교체. 제거된 relay는 구독을 떼고 닫는다(단, 활성
   * session lease가 있으면 lease 만료가 닫는다). 연결은 병렬 — 느린 relay가
   * unlock을 직렬로 막지 않는다.
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
   * session lease (§10 B3): persistent 밖 relay의 단명 연결. release()는
   * publish 확인 후 호출 — refs 0이 되면 TTL 뒤에 닫는다. persistent∩session
   * 중첩 시[N9] lease는 no-op(만료가 persistent 연결을 닫지 않는다).
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
              // 그 사이 persistent로 승격됐다면 닫지 않는다 [N9]
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
    // 원형 URL로 반환 — RelayManagement 화면의 설정 키와 일치해야 한다
    return this.persistentTargets.map((url) => ({
      url,
      connected: this.connected.has(relayIdentity(url)),
    }))
  }

  /** publish/query 대상 — 연결된 persistent relay만 (session은 명시 경로 전용) */
  getConnectedPersistent(): string[] {
    return this.persistentTargets.filter((u) => this.connected.has(relayIdentity(u)))
  }

  // ─── 구독 레지스트리 (B4) ───

  /**
   * persistent 집합 대상 구독. 등록 즉시 현재 연결된 persistent relay에 attach
   * 되고, 이후 (재)연결되는 relay에도 자동 attach된다 — subscribe 시점 연결
   * 스냅샷에만 붙던 구경로 레이스의 근본 수정.
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

  // ─── 조회/발행 스코프 (B6) ───

  /** persistent 연결 대상 발행. 성공 relay 수를 반환. */
  async publish(event: unknown): Promise<{ ok: string[]; failed: string[] }> {
    const relays = this.getConnectedPersistent()
    return this.publishTo(relays, event)
  }

  /** 명시 relay 발행 — session lease를 획득하고 확인 후 해제한다. */
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

  // ─── EOSE 수집 엔진 (B5 — catch-up의 per-relay 배선) ───

  /**
   * relay별 독립 REQ로 진짜 EOSE까지 수집한다. querySync(timeout 드레인)와 달리
   * 어떤 relay가 어디까지 줬는지를 노출한다 — per-relay cursor 전진의 전제.
   *
   * - filterFor(relay): relay별 since를 넣은 필터 (호출자가 도메인 규칙으로 계산)
   * - 각 relay는 진짜 EOSE(eoseTimeout으로 합성 차단) 또는 maxWaitMs에 종료
   * - 연결 자체도 상한 5s (리뷰 #3 — 블랙홀 네트워크에서 ensureRelay가 무한
   *   대기하면 catch-up이 행, isSyncing 락이 후속 동기화까지 막는다)
   * - 반환: id-dedup된 이벤트 + 진짜 EOSE에 도달한 relay 목록
   */
  async collectUntilEose(params: {
    relays: string[]
    filterFor: (relayUrl: string) => NostrFilter
    maxWaitMs: number
    /** 합성 EOSE 차단값 — gateway의 CURSOR_EOSE_TIMEOUT_MS를 넘긴다 */
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

  // ─── 내부: attach 보장 + 재연결 (B3/B4) ───

  /**
   * 연결 상한 관통 (리뷰 #3): AbstractRelay.connect는 timeout 옵션이 없으면
   * 타임아웃 핸들 자체가 없다 — 블랙홀 네트워크(캡티브 포털)에서 pending이
   * 영원히 남는다. 모든 ensureRelay 사용처가 이 헬퍼를 거친다.
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

  /** (재)연결된 relay에 등록 구독 전부 attach — 이미 붙어 있으면 no-op */
  private attachSubscriptionsTo(url: string): void {
    for (const sub of this.subs.values()) {
      this.attachSubTo(sub, url)
    }
  }

  private attachSubTo(sub: RegisteredSubscription, url: string): void {
    const id = relayIdentity(url)
    if (sub.attached.has(id)) return
    // 자리 선점 — ensureRelay 비동기 완료 전 중복 attach 방지
    sub.attached.set(id, { close: () => {} })
    this.ensureRelayWithTimeout(url)
      .then((relay) => {
        // unsubscribe가 선행됐으면(attached에서 제거됨) 붙이지 않는다
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
        // 의도적 close(우리의 detach/unsubscribe)와 relay측 종료(CLOSED·소켓
        // 사망)를 구분한다 — 후자는 원장에서 지워 다음 헬스체크가 재attach하게.
        // ensureRelay가 죽은 소켓을 조용히 되살리면 socket 관찰로는 구독 유실을
        // 볼 수 없으므로, 구독 자신의 종료 신호가 유일하게 신뢰 가능한 원천이다.
        let intentionalClose = false
        const inner = relay.subscribe(
          // filters 참조를 relay별 Subscription과 공유하지 않는다 (리뷰 NIT —
          // 라이브러리가 저장만 하지만, 얕은 복제가 변이 경로를 원천 차단)
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
        // unsubscribe race 재확인 — close된 자리에 살아있는 핸들을 남기지 않는다
        if (!sub.attached.has(id)) {
          handle.close()
          return
        }
        sub.attached.set(id, handle)
      })
      .catch((error) => {
        // 실패한 자리 선점 제거 — 다음 헬스체크/재연결이 재시도한다
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
   * 죽은 relay만 감지·재연결하고 **그 relay만** attach한다 (§10 B4 — 구경로의
   * "재연결 1건 → 전 구독×전 relay 재오픈" churn 폐기).
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
          // 다음 주기/wake에 재시도
        }
      }
    }

    // 연결은 살아있지만(ensureRelay가 조용히 되살린 경우 포함) relay측 종료로
    // 원장에서 빠진 구독을 채운다 — onclose 신호와 이 보충이 한 쌍이다.
    for (const url of this.persistentTargets) {
      if (this.connected.has(relayIdentity(url))) {
        this.attachSubscriptionsTo(url)
      }
    }
  }
}
