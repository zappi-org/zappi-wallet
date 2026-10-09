import { Err, Ok, type Result } from '@/core/domain/result'
import { RemoteSigningError } from '@/core/errors/remote-signing'
import {
  SIGNER_FRESHNESS_WINDOW_SEC,
  SIGNER_REQUEST_KIND,
  isFresh,
  isPermitted,
  isValidEventToSign,
  parseSignerUri,
  summarizeEvent,
  type NostrConnectRequest,
  type SignerApprovalRequest,
  type SignerPermission,
  type SignerRequest,
  type SignerResponse,
  type SignerSession,
  type SignerUriResult,
} from '@/core/domain/remote-signing'
import type { NostrEvent, UnsignedNostrEvent } from '@/core/domain/nostr'
import type { EventBus } from '@/core/events/event-bus'
import type { SignerSessionStore } from '@/core/ports/driven/signer-session-store.port'
import type { SignerTransport } from '@/core/ports/driven/signer-transport.port'
import type { RemoteSigningUseCase } from '@/core/ports/driving/remote-signing.usecase'

export interface RemoteSigningConfig {
  /** The user's nostr pubkey (hex) — replied to `get_public_key`. */
  selfPubkey: string
  freshnessWindowSec?: number
  approvalTimeoutMs?: number
  now?: () => number
}

const DEFAULT_APPROVAL_TIMEOUT_MS = 60_000

/**
 * RemoteSigningService — Zappi's NIP-46 remote-signer.
 *
 * Handles the client-initiated flow only: the user scans a `nostrconnect://`
 * URI, approves, and the signer answers `connect` plus subsequent requests.
 * Anti-replay: durable request-id dedupe + a freshness window (NIP-46 has no
 * nonce) + single-use connect secrets.
 */
export class RemoteSigningService implements RemoteSigningUseCase {
  private stopSub: (() => void) | null = null
  private subscribedRelays: string[] = []
  private started = false
  private readonly approvals = new Map<string, (allow: boolean) => void>()
  /** Concurrent-redelivery guard (same event via two relays); the durable store covers later redelivery. */
  private readonly inflight = new Set<string>()

  constructor(
    private readonly transport: SignerTransport,
    private readonly store: SignerSessionStore,
    private readonly eventBus: EventBus,
    private readonly config: RemoteSigningConfig,
  ) {}

  parseIncoming(raw: string): SignerUriResult {
    return parseSignerUri(raw)
  }

  async approveConnection(
    request: NostrConnectRequest,
    permissions?: SignerPermission[],
  ): Promise<Result<SignerSession, RemoteSigningError>> {
    if (await this.store.hasUsedSecret(request.secret)) {
      return Err(new RemoteSigningError('SIGNER_SECRET_REUSED', 'connect secret already used'))
    }
    await this.store.markSecretUsed(request.secret, this.nowSec() + this.windowSec() * 2)

    const now = Date.now()
    const session: SignerSession = {
      clientPubkey: request.clientPubkey,
      relays: request.relays,
      permissions: permissions ?? request.permissions,
      name: request.name,
      url: request.url,
      image: request.image,
      createdAt: now,
      lastUsedAt: now,
    }

    // Client-initiated flow: the signer answers with the echoed secret (the client
    // validates it; there is no inbound `connect` request to wait for). Persist
    // only after the response lands — a transport or storage failure must not
    // leave the secret consumed with no session, so release it and bail out.
    try {
      await this.transport.respond(request.clientPubkey, request.relays, {
        id: randomId(),
        result: request.secret,
      })
      await this.store.saveSession(session)
    } catch (cause) {
      await this.store.releaseSecret(request.secret)
      return Err(new RemoteSigningError('SIGNER_TRANSPORT_FAILED', 'connect approval failed', cause))
    }

    await this.resubscribe()
    this.eventBus.emit({ type: 'signer:session-opened', payload: { session } })
    return Ok(session)
  }

  async listSessions(): Promise<SignerSession[]> {
    return this.store.listSessions()
  }

  async revokeSession(clientPubkey: string): Promise<void> {
    await this.store.deleteSession(clientPubkey)
    await this.resubscribe()
    this.eventBus.emit({ type: 'signer:session-revoked', payload: { clientPubkey } })
  }

  resolveApproval(approvalId: string, allow: boolean): void {
    const resolve = this.approvals.get(approvalId)
    if (!resolve) return
    this.approvals.delete(approvalId)
    resolve(allow)
  }

  async start(): Promise<void> {
    this.started = true
    await this.store.pruneProcessed(this.nowSec())
    await this.resubscribe()
  }

  stop(): void {
    this.started = false
    this.stopSub?.()
    this.stopSub = null
    this.subscribedRelays = []
    this.transport.dispose()
  }

  // ─── Request loop ───

  private async handleEvent(event: NostrEvent): Promise<void> {
    if (event.kind !== SIGNER_REQUEST_KIND) return
    if (this.inflight.has(event.id)) return
    this.inflight.add(event.id)
    try {
      await this.processEvent(event)
    } finally {
      this.inflight.delete(event.id)
    }
  }

  private async processEvent(event: NostrEvent): Promise<void> {
    const nowSec = this.nowSec()

    // Anti-replay: freshness window + durable event-id dedupe.
    if (!isFresh(event.created_at, nowSec, this.windowSec())) return
    const eventKey = `evt:${event.id}`
    if (await this.store.hasProcessed(eventKey)) return

    const session = await this.store.getSession(event.pubkey)
    if (!session) return // unknown client — ignore

    let request: SignerRequest
    try {
      request = JSON.parse(this.transport.decrypt(event.pubkey, event.content)) as SignerRequest
    } catch {
      return
    }
    if (!request || typeof request.id !== 'string' || typeof request.method !== 'string') return

    const requestKey = `req:${event.pubkey}:${request.id}`
    if (await this.store.hasProcessed(requestKey)) return

    // Mark before dispatch so a redelivery mid-processing can't double-run.
    const expiry = nowSec + this.windowSec() * 2
    await this.store.markProcessed(eventKey, expiry)
    await this.store.markProcessed(requestKey, expiry)

    // Touch lastUsedAt before dispatch — logout deletes the session inside dispatch.
    await this.store.saveSession({ ...session, lastUsedAt: Date.now() })
    const response = await this.dispatch(session, request)

    try {
      await this.transport.respond(event.pubkey, session.relays, response)
    } catch {
      // Relay flake — the client times out and re-sends with a new request id.
    }

    if (request.method === 'logout') await this.resubscribe()
  }

  private async dispatch(session: SignerSession, request: SignerRequest): Promise<SignerResponse> {
    const { id, method, params } = request
    switch (method) {
      // `connect` is handled by approveConnection (client-initiated flow); there is
      // no inbound connect request to answer here.
      case 'ping':
        return { id, result: 'pong' }
      case 'get_public_key':
        return { id, result: this.config.selfPubkey }
      case 'switch_relays':
        // ponytail: no relay control — client keeps its own set (NIP-46 SHOULD).
        return { id, result: 'null' }
      case 'nip44_encrypt':
      case 'nip44_decrypt': {
        if (!isPermitted(session.permissions, method)) return { id, error: 'permission denied' }
        const [thirdParty, payload] = params
        if (!thirdParty || typeof payload !== 'string') return { id, error: 'invalid params' }
        try {
          const result =
            method === 'nip44_encrypt'
              ? this.transport.encrypt(thirdParty, payload)
              : this.transport.decrypt(thirdParty, payload)
          return { id, result }
        } catch {
          return { id, error: 'crypto failed' }
        }
      }
      case 'logout':
        await this.store.deleteSession(session.clientPubkey)
        this.eventBus.emit({
          type: 'signer:session-revoked',
          payload: { clientPubkey: session.clientPubkey },
        })
        return { id, result: 'ack' }
      case 'sign_event':
        return this.handleSign(session, id, params)
      default:
        return { id, error: 'unsupported method' }
    }
  }

  private async handleSign(
    session: SignerSession,
    id: string,
    params: string[],
  ): Promise<SignerResponse> {
    let event: UnsignedNostrEvent
    try {
      event = JSON.parse(params[0] ?? '') as UnsignedNostrEvent
    } catch {
      return { id, error: 'invalid event' }
    }
    if (!isValidEventToSign(event, this.config.selfPubkey, this.nowSec(), this.windowSec())) {
      return { id, error: 'invalid event' }
    }

    if (!isPermitted(session.permissions, 'sign_event', event.kind)) {
      const allow = await this.requestApproval(session, event)
      if (!allow) return { id, error: 'permission denied' }
    }

    try {
      return { id, result: JSON.stringify(this.transport.signEvent(event)) }
    } catch {
      return { id, error: 'signing failed' }
    }
  }

  private requestApproval(session: SignerSession, event: UnsignedNostrEvent): Promise<boolean> {
    const approvalId = randomId()
    const approval: SignerApprovalRequest = {
      approvalId,
      clientPubkey: session.clientPubkey,
      name: session.name,
      url: session.url,
      method: 'sign_event',
      kind: event.kind,
      preview: summarizeEvent(event),
    }
    return new Promise<boolean>((resolve) => {
      const finish = (allow: boolean) => {
        clearTimeout(timeout)
        this.approvals.delete(approvalId)
        resolve(allow)
      }
      const timeout = setTimeout(
        () => finish(false),
        this.config.approvalTimeoutMs ?? DEFAULT_APPROVAL_TIMEOUT_MS,
      )
      this.approvals.set(approvalId, finish)
      this.eventBus.emit({ type: 'signer:approval-requested', payload: { request: approval } })
    })
  }

  // ─── Subscription management ───

  /** Subscribe to the union of all session relays. Re-called whenever the set changes. */
  private async resubscribe(): Promise<void> {
    if (!this.started) return
    const sessions = await this.store.listSessions()
    const relays = unionRelays(sessions)
    if (sameSet(relays, this.subscribedRelays)) return

    this.stopSub?.()
    this.stopSub = null
    this.subscribedRelays = relays
    if (relays.length === 0) return
    this.stopSub = this.transport.subscribe(relays, (event) => {
      void this.handleEvent(event)
    })
  }

  private nowSec(): number {
    return Math.floor((this.config.now?.() ?? Date.now()) / 1000)
  }

  private windowSec(): number {
    return this.config.freshnessWindowSec ?? SIGNER_FRESHNESS_WINDOW_SEC
  }
}

function randomId(): string {
  return crypto.randomUUID()
}

function unionRelays(sessions: SignerSession[]): string[] {
  const out: string[] = []
  for (const session of sessions) {
    for (const relay of session.relays) {
      if (!out.includes(relay)) out.push(relay)
    }
  }
  return out
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((url) => b.includes(url))
}
