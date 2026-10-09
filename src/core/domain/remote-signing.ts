/**
 * NIP-46 remote signing — domain types and pure helpers.
 *
 * Zappi is the remote-signer (bunker): it scans a client's `nostrconnect://`
 * URI and answers signing requests. Pure: no I/O, no SDK types.
 */

import type { UnsignedNostrEvent } from './nostr'

/** NIP-46 request/response event kind (ephemeral range 20000–29999). */
export const SIGNER_REQUEST_KIND = 24133
/**
 * NIP-46 carries no freshness field, so the signer enforces one itself:
 * requests older/newer than this window are dropped (anti-replay).
 */
export const SIGNER_FRESHNESS_WINDOW_SEC = 120

export type SignerMethod =
  | 'connect'
  | 'ping'
  | 'get_public_key'
  | 'sign_event'
  | 'nip44_encrypt'
  | 'nip44_decrypt'
  | 'switch_relays'
  | 'logout'

export interface SignerPermission {
  method: SignerMethod
  /** sign_event only: restrict to this kind. Absent = any kind. */
  kind?: number
}

/** Client-initiated connection: the URI the website shows as a QR. */
export interface NostrConnectRequest {
  kind: 'nostrconnect'
  clientPubkey: string
  relays: string[]
  secret: string
  permissions: SignerPermission[]
  name?: string
  url?: string
  image?: string
}

export type SignerUriError =
  | 'unsupported-scheme'
  | 'invalid-uri'
  | 'bad-pubkey'
  | 'no-relay'
  | 'missing-secret'

export type SignerUriResult =
  | { ok: true; request: NostrConnectRequest }
  | { ok: false; reason: SignerUriError }

export interface SignerSession {
  clientPubkey: string
  permissions: SignerPermission[]
  relays: string[]
  /** Unauthenticated client metadata — display hint only, never authorization. */
  name?: string
  url?: string
  image?: string
  createdAt: number
  lastUsedAt: number
}

export interface SignerRequest {
  id: string
  method: string
  params: string[]
}

export interface SignerResponse {
  id: string
  result?: string
  error?: string
}

/** Emitted when a sign_event falls outside the session's pre-approved permissions. */
export interface SignerApprovalRequest {
  approvalId: string
  clientPubkey: string
  name?: string
  url?: string
  method: string
  kind?: number
  preview: string
}

const HEX64 = /^[0-9a-f]{64}$/
const RELAY_SCHEME = /^wss:\/\//i
const METHODS = new Set<SignerMethod>([
  'connect',
  'ping',
  'get_public_key',
  'sign_event',
  'nip44_encrypt',
  'nip44_decrypt',
  'switch_relays',
  'logout',
])

function normalizeRelays(urls: string[]): string[] {
  const out: string[] = []
  for (const raw of urls) {
    const url = raw.trim()
    if (!RELAY_SCHEME.test(url)) continue
    if (!out.includes(url)) out.push(url)
  }
  return out
}

/**
 * Parse a `nostrconnect://` URI (client connects to us).
 *
 * `bunker://` is deliberately unsupported: it is the URI a *remote signer*
 * hands to a client, i.e. the opposite direction — Zappi already is the signer.
 */
export function parseSignerUri(raw: string): SignerUriResult {
  const input = raw.trim()
  if (input.startsWith('nostrconnect://')) return parseNostrConnect(input)
  return { ok: false, reason: 'unsupported-scheme' }
}

function parseNostrConnect(input: string): SignerUriResult {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    return { ok: false, reason: 'invalid-uri' }
  }
  // Custom scheme: the hex pubkey lands in `host` (pathname fallback for odd parsers).
  const clientPubkey = (url.host || url.pathname.replace(/^\/+/, '')).toLowerCase()
  if (!HEX64.test(clientPubkey)) return { ok: false, reason: 'bad-pubkey' }

  const relays = normalizeRelays(url.searchParams.getAll('relay'))
  if (relays.length === 0) return { ok: false, reason: 'no-relay' }

  const secret = url.searchParams.get('secret') ?? ''
  if (!secret) return { ok: false, reason: 'missing-secret' }

  return {
    ok: true,
    request: {
      kind: 'nostrconnect',
      clientPubkey,
      relays,
      secret,
      permissions: parsePermissions(url.searchParams.get('perms') ?? ''),
      name: url.searchParams.get('name') ?? undefined,
      url: url.searchParams.get('url') ?? undefined,
      image: url.searchParams.get('image') ?? undefined,
    },
  }
}

/** Parse `"nip44_encrypt,sign_event:4"`. Unknown methods are dropped. */
export function parsePermissions(raw: string): SignerPermission[] {
  const out: SignerPermission[] = []
  for (const token of raw.split(',')) {
    const trimmed = token.trim()
    if (!trimmed) continue
    const [method, kindStr] = trimmed.split(':')
    if (!METHODS.has(method as SignerMethod)) continue
    const permission: SignerPermission = { method: method as SignerMethod }
    if (method === 'sign_event' && kindStr !== undefined) {
      const kind = Number(kindStr)
      if (Number.isInteger(kind) && kind >= 0) permission.kind = kind
    }
    if (!out.some((p) => p.method === permission.method && p.kind === permission.kind)) {
      out.push(permission)
    }
  }
  return out
}

export function serializePermissions(permissions: SignerPermission[]): string {
  return permissions
    .map((p) => (p.kind === undefined ? p.method : `${p.method}:${p.kind}`))
    .join(',')
}

/** Does `permissions` allow this method (and kind, for sign_event)? */
export function isPermitted(
  permissions: SignerPermission[],
  method: SignerMethod,
  kind?: number,
): boolean {
  if (method === 'sign_event') {
    return permissions.some(
      (p) => p.method === 'sign_event' && (p.kind === undefined || p.kind === kind),
    )
  }
  return permissions.some((p) => p.method === method)
}

/** NIP-46 has no freshness field — reject requests outside the window. */
export function isFresh(
  createdAtSec: number,
  nowSec: number,
  windowSec = SIGNER_FRESHNESS_WINDOW_SEC,
): boolean {
  return Math.abs(nowSec - createdAtSec) <= windowSec
}

/**
 * Validate an event the client asked us to sign before spending the user's key.
 *
 * Rejects a mismatched pubkey (transport would silently re-sign with ours) and
 * a stale/absent `created_at` (a valid signature is permanent, so an old
 * `created_at` is a replay vector). A missing pubkey is allowed — it is filled
 * from our key at signing time.
 */
export function isValidEventToSign(
  event: UnsignedNostrEvent,
  signerPubkey: string,
  nowSec: number,
  windowSec = SIGNER_FRESHNESS_WINDOW_SEC,
): boolean {
  if (!event || typeof event.kind !== 'number' || typeof event.content !== 'string') return false
  if (typeof event.created_at !== 'number' || !isFresh(event.created_at, nowSec, windowSec)) {
    return false
  }
  if (typeof event.pubkey === 'string' && event.pubkey.toLowerCase() !== signerPubkey.toLowerCase()) {
    return false
  }
  return true
}

/** Short, display-only preview of an event to sign. */
export function summarizeEvent(event: UnsignedNostrEvent): string {
  const content = event.content.length > 140 ? `${event.content.slice(0, 137)}…` : event.content
  return `kind ${event.kind}: ${content}`
}
