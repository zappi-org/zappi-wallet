import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RemoteSigningService } from '@/core/services/remote-signing.service'
import { createEventBus } from '@/core/events/event-bus'
import { SIGNER_REQUEST_KIND, type NostrConnectRequest, type SignerPermission, type SignerResponse, type SignerSession } from '@/core/domain/remote-signing'
import type { NostrEvent, UnsignedNostrEvent } from '@/core/domain/nostr'
import type { EventBus } from '@/core/events/event-bus'
import type { SignerSessionStore } from '@/core/ports/driven/signer-session-store.port'
import type { SignerTransport } from '@/core/ports/driven/signer-transport.port'

const CLIENT = 'a'.repeat(64)
const OTHER_CLIENT = 'b'.repeat(64)
const USER = 'c'.repeat(64)
const RELAY = 'wss://relay.example.com'
const NOW_MS = 1_000_000
const NOW_SEC = NOW_MS / 1000

function makeTransport() {
  const published: { clientPubkey: string; response: SignerResponse }[] = []
  let handler: ((event: NostrEvent) => void) | null = null

  const transport: SignerTransport = {
    subscribe: vi.fn((_relays: string[], onRequest: (event: NostrEvent) => void) => {
      handler = onRequest
      return () => {
        handler = null
      }
    }),
    respond: vi.fn(async (clientPubkey: string, _relays: string[], response: SignerResponse) => {
      published.push({ clientPubkey, response })
    }),
    encrypt: vi.fn((_pk: string, plaintext: string) => `enc:${plaintext}`),
    decrypt: vi.fn((_pk: string, ciphertext: string) => ciphertext.replace(/^enc:/, '')),
    signEvent: vi.fn((event: UnsignedNostrEvent) => ({ ...event, id: `sig-${event.kind}`, sig: 'x' }) as NostrEvent),
    dispose: vi.fn(),
  }
  return { transport, published, fire: (event: NostrEvent) => handler?.(event) }
}

function makeStore() {
  const sessions = new Map<string, SignerSession>()
  const processed = new Set<string>()
  const secrets = new Set<string>()
  const store: SignerSessionStore = {
    listSessions: vi.fn(async () => [...sessions.values()]),
    getSession: vi.fn(async (pk: string) => sessions.get(pk) ?? null),
    saveSession: vi.fn(async (s: SignerSession) => {
      sessions.set(s.clientPubkey, s)
    }),
    deleteSession: vi.fn(async (pk: string) => {
      sessions.delete(pk)
    }),
    hasProcessed: vi.fn(async (id: string) => processed.has(id)),
    markProcessed: vi.fn(async (id: string) => {
      processed.add(id)
    }),
    pruneProcessed: vi.fn(async () => {}),
    hasUsedSecret: vi.fn(async (s: string) => secrets.has(s)),
    markSecretUsed: vi.fn(async (s: string) => {
      secrets.add(s)
    }),
    releaseSecret: vi.fn(async (s: string) => {
      secrets.delete(s)
    }),
  }
  return { store, sessions, secrets }
}

function requestEvent(
  request: { id: string; method: string; params: string[] },
  overrides: Partial<NostrEvent> = {},
): NostrEvent {
  return {
    id: overrides.id ?? `evt-${request.id}`,
    pubkey: overrides.pubkey ?? CLIENT,
    created_at: overrides.created_at ?? NOW_SEC,
    kind: SIGNER_REQUEST_KIND,
    tags: [['p', USER]],
    content: `enc:${JSON.stringify(request)}`,
    sig: 'x',
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

async function waitFor(predicate: () => boolean, tries = 20): Promise<void> {
  for (let i = 0; i < tries && !predicate(); i++) await flush()
}

describe('RemoteSigningService', () => {
  let transport: ReturnType<typeof makeTransport>
  let store: ReturnType<typeof makeStore>
  let eventBus: EventBus
  let service: RemoteSigningService

  const connectRequest = (secret = 's1'): NostrConnectRequest => ({
    kind: 'nostrconnect',
    clientPubkey: CLIENT,
    relays: [RELAY],
    secret,
    permissions: [{ method: 'sign_event', kind: 1 }],
    name: 'My Client',
  })

  async function seedSession(permissions: SignerPermission[] = [{ method: 'sign_event', kind: 1 }]) {
    await service.start()
    await service.approveConnection({ ...connectRequest(), permissions })
  }

  beforeEach(() => {
    transport = makeTransport()
    store = makeStore()
    eventBus = createEventBus()
    service = new RemoteSigningService(transport.transport, store.store, eventBus, {
      selfPubkey: USER,
      now: () => NOW_MS,
      approvalTimeoutMs: 10_000,
    })
  })

  describe('approveConnection', () => {
    it('opens a session, marks the secret used, answers with the secret, and subscribes', async () => {
      await service.start()
      const result = await service.approveConnection(connectRequest())

      expect(result.ok).toBe(true)
      if (result.ok) expect(result.value.clientPubkey).toBe(CLIENT)
      expect(store.sessions.has(CLIENT)).toBe(true)
      expect(transport.transport.respond).toHaveBeenCalledWith(CLIENT, [RELAY], {
        id: expect.any(String),
        result: 's1',
      })
      expect(transport.transport.subscribe).toHaveBeenCalledWith([RELAY], expect.any(Function))
    })

    it('rejects a reused connect secret', async () => {
      await service.start()
      await service.approveConnection(connectRequest('s1'))
      const second = await service.approveConnection(connectRequest('s1'))

      expect(second.ok).toBe(false)
      if (!second.ok) expect(second.error.code).toBe('SIGNER_SECRET_REUSED')
    })

    it('rolls back the session and secret when the connect response fails', async () => {
      await service.start()
      vi.mocked(transport.transport.respond).mockRejectedValueOnce(new Error('relay down'))

      const result = await service.approveConnection(connectRequest('s1'))

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('SIGNER_TRANSPORT_FAILED')
      expect(store.sessions.has(CLIENT)).toBe(false)
      expect(store.secrets.has('s1')).toBe(false)
      // Retry with the same secret now succeeds (the client never got the ack).
      expect((await service.approveConnection(connectRequest('s1'))).ok).toBe(true)
    })

    it('releases the secret when persisting the session fails', async () => {
      await service.start()
      vi.mocked(store.store.saveSession).mockRejectedValueOnce(new Error('quota exceeded'))

      const result = await service.approveConnection(connectRequest('s1'))

      expect(result.ok).toBe(false)
      expect(store.sessions.has(CLIENT)).toBe(false)
      expect(store.secrets.has('s1')).toBe(false)
    })
  })

  describe('request dispatch', () => {
    it('answers ping and get_public_key', async () => {
      await seedSession()

      transport.fire(requestEvent({ id: 'r1', method: 'ping', params: [] }))
      transport.fire(requestEvent({ id: 'r2', method: 'get_public_key', params: [] }))
      await flush()

      const results = transport.published.map((p) => p.response)
      expect(results).toContainEqual({ id: 'r1', result: 'pong' })
      expect(results).toContainEqual({ id: 'r2', result: USER })
    })

    it('signs an event inside the session permissions', async () => {
      await seedSession([{ method: 'sign_event', kind: 1 }])
      const event = { kind: 1, content: 'hello', tags: [], created_at: NOW_SEC, pubkey: USER }

      transport.fire(requestEvent({ id: 'r1', method: 'sign_event', params: [JSON.stringify(event)] }))
      await flush()

      const response = transport.published.at(-1)?.response
      expect(response?.id).toBe('r1')
      expect(response?.error).toBeUndefined()
      expect(JSON.parse(response?.result ?? '{}')).toMatchObject({ kind: 1, sig: 'x' })
    })

    it('requires approval for a kind outside the permissions', async () => {
      const approvals: string[] = []
      eventBus.on('signer:approval-requested', (e) => approvals.push(e.payload.request.approvalId))
      await seedSession([{ method: 'sign_event', kind: 1 }])
      const event = { kind: 2, content: 'dm', tags: [], created_at: NOW_SEC, pubkey: USER }

      transport.fire(requestEvent({ id: 'r1', method: 'sign_event', params: [JSON.stringify(event)] }))
      await waitFor(() => approvals.length > 0)
      expect(approvals).toHaveLength(1)

      service.resolveApproval(approvals[0], true)
      await flush()
      expect(transport.published.at(-1)?.response.result).toContain('sig-2')
    })

    it('handles nip44_encrypt/decrypt when permitted', async () => {
      await seedSession([{ method: 'nip44_encrypt' }, { method: 'nip44_decrypt' }])

      transport.fire(
        requestEvent({ id: 'e1', method: 'nip44_encrypt', params: [OTHER_CLIENT, 'hi'] }),
      )
      transport.fire(
        requestEvent({ id: 'e2', method: 'nip44_decrypt', params: [OTHER_CLIENT, 'enc:hi'] }),
      )
      await flush()

      expect(transport.published).toContainEqual({
        clientPubkey: CLIENT,
        response: { id: 'e1', result: 'enc:hi' },
      })
      expect(transport.transport.decrypt).toHaveBeenCalledWith(OTHER_CLIENT, 'enc:hi')
      expect(transport.published).toContainEqual({
        clientPubkey: CLIENT,
        response: { id: 'e2', result: 'hi' },
      })
    })

    it('denies nip44 methods outside the session permissions', async () => {
      await seedSession([{ method: 'ping' }])

      transport.fire(
        requestEvent({ id: 'e1', method: 'nip44_encrypt', params: [OTHER_CLIENT, 'hi'] }),
      )
      await flush()

      expect(transport.published).toContainEqual({
        clientPubkey: CLIENT,
        response: { id: 'e1', error: 'permission denied' },
      })
    })

    it('rejects a sign_event whose inner pubkey or created_at is wrong', async () => {
      await seedSession([{ method: 'sign_event', kind: 1 }])

      transport.fire(
        requestEvent({
          id: 'bad-pk',
          method: 'sign_event',
          params: [JSON.stringify({ kind: 1, content: 'x', tags: [], created_at: NOW_SEC, pubkey: OTHER_CLIENT })],
        }),
      )
      transport.fire(
        requestEvent({
          id: 'stale',
          method: 'sign_event',
          params: [JSON.stringify({ kind: 1, content: 'x', tags: [], created_at: NOW_SEC - 10_000, pubkey: USER })],
        }),
      )
      await flush()

      const responses = transport.published.map((p) => p.response)
      expect(responses).toContainEqual({ id: 'bad-pk', error: 'invalid event' })
      expect(responses).toContainEqual({ id: 'stale', error: 'invalid event' })
    })

    it('returns an error when the approval is denied', async () => {
      const approvals: string[] = []
      eventBus.on('signer:approval-requested', (e) => approvals.push(e.payload.request.approvalId))
      await seedSession([{ method: 'sign_event', kind: 1 }])
      const event = { kind: 2, content: 'dm', tags: [], created_at: NOW_SEC, pubkey: USER }

      transport.fire(requestEvent({ id: 'r1', method: 'sign_event', params: [JSON.stringify(event)] }))
      await waitFor(() => approvals.length > 0)
      service.resolveApproval(approvals[0], false)
      await flush()

      expect(transport.published.at(-1)?.response).toMatchObject({ id: 'r1', error: 'permission denied' })
    })
  })

  describe('anti-replay', () => {
    it('ignores a redelivered event', async () => {
      await seedSession()
      const event = requestEvent({ id: 'r1', method: 'ping', params: [] })

      transport.fire(event)
      await flush()
      transport.fire(event)
      await flush()

      expect(transport.published.filter((p) => p.response.id === 'r1')).toHaveLength(1)
    })

    it('ignores a stale event outside the freshness window', async () => {
      await seedSession()
      transport.fire(
        requestEvent({ id: 'r1', method: 'ping', params: [] }, { created_at: NOW_SEC - 10_000 }),
      )
      await flush()

      expect(transport.published.some((p) => p.response.id === 'r1')).toBe(false)
    })

    it('ignores requests from an unknown client', async () => {
      await seedSession()
      transport.fire(requestEvent({ id: 'r1', method: 'ping', params: [] }, { pubkey: OTHER_CLIENT }))
      await flush()

      expect(transport.published.some((p) => p.response.id === 'r1')).toBe(false)
    })
  })

  describe('logout', () => {
    it('deletes the session and acknowledges', async () => {
      await seedSession()
      transport.fire(requestEvent({ id: 'r1', method: 'logout', params: [] }))
      await flush()

      expect(store.sessions.has(CLIENT)).toBe(false)
      expect(transport.published.at(-1)?.response).toMatchObject({ id: 'r1', result: 'ack' })
    })
  })
})
