/**
 * NUT-18 Payment Request Service
 * Handles encoding/decoding of Cashu payment requests with transport support
 *
 * Format: creqA{base64url_cbor}
 *
 * CBOR Structure:
 * {
 *   a: number,      // amount (optional)
 *   u: string,      // unit (e.g., "sat")
 *   m: string[],    // mints
 *   d: string,      // description (optional)
 *   s: boolean,     // single use
 *   t: Transport[], // transports
 * }
 *
 * Transport:
 * {
 *   t: string,      // type: "nostr" | "post"
 *   a: string,      // address: npub/nprofile for nostr, URL for post
 *   n?: string[],   // nonce array (optional)
 * }
 */

import { encode as encodeCbor, decode as decodeCbor } from 'cbor-x'

// ============= Types =============

export type TransportType = 'nostr' | 'post'

export interface PaymentRequestTransport {
  type: TransportType
  target: string // npub or nprofile for nostr, URL for post
  nonce?: string[]
}

export interface PaymentRequest {
  id: string
  amount?: number
  unit: string
  mints: string[]
  description?: string
  singleUse: boolean
  transports: PaymentRequestTransport[]
}

// CBOR structure (internal)
interface CborPaymentRequest {
  i?: string       // id (optional in spec, we generate)
  a?: number       // amount
  u: string        // unit
  m: string[]      // mints
  d?: string       // description
  s?: boolean      // single use
  t: CborTransport[]
}

interface CborTransport {
  t: string        // type
  a: string        // address
  n?: string[]     // nonce
}

// ============= Constants =============

const PAYMENT_REQUEST_PREFIX = 'creqA'
const CASHU_URI_PREFIX = 'cashu://'

// ============= Encoding =============

/**
 * Create a NUT-18 payment request with Nostr transport
 * Returns both the encoded request string and the request ID for tracking
 *
 * @param nostrTarget - Can be npub (npub1...) or nprofile (nprofile1...) with relay hints
 *                      nprofile is recommended for better deliverability as it includes relay hints
 */
export function createNostrPaymentRequest(options: {
  amount?: number
  mints: string[]
  nostrTarget: string  // npub or nprofile (nprofile recommended for relay hints)
  description?: string
  singleUse?: boolean
  idPrefix?: string    // e.g. 'wallet'
}): { request: string; id: string } {
  const { amount, mints, nostrTarget, description, singleUse = true, idPrefix } = options

  const id = generateRequestId(idPrefix)

  const paymentRequest: PaymentRequest = {
    id,
    amount,
    unit: 'sat',
    mints,
    description,
    singleUse,
    transports: [
      {
        type: 'nostr',
        target: nostrTarget,
      },
    ],
  }

  return {
    request: encodePaymentRequest(paymentRequest),
    id,
  }
}

/**
 * Create a NUT-18 payment request with HTTP POST transport
 */
export function createPostPaymentRequest(options: {
  amount?: number
  mints: string[]
  postUrl: string
  description?: string
  singleUse?: boolean
}): string {
  const { amount, mints, postUrl, description, singleUse = true } = options

  const id = generateRequestId()

  const request: PaymentRequest = {
    id,
    amount,
    unit: 'sat',
    mints,
    description,
    singleUse,
    transports: [
      {
        type: 'post',
        target: postUrl,
      },
    ],
  }

  return encodePaymentRequest(request)
}

/**
 * Create a NUT-18 payment request with dual transport (Nostr primary + HTTP POST fallback).
 * Nostr is listed first (primary), HTTP POST second (fallback).
 */
export function createDualTransportPaymentRequest(options: {
  amount?: number
  mints: string[]
  nostrTarget: string   // npub or nprofile
  mintUrl: string       // mint URL for constructing HTTP endpoint
  description?: string
  singleUse?: boolean
  idPrefix?: string
}): { request: string; id: string; httpEndpoint: string } {
  const { amount, mints, nostrTarget, mintUrl, description, singleUse = true, idPrefix } = options

  const id = generateRequestId(idPrefix)
  const httpEndpoint = buildHttpEndpoint(mintUrl, id)

  const paymentRequest: PaymentRequest = {
    id,
    amount,
    unit: 'sat',
    mints,
    description,
    singleUse,
    transports: [
      {
        type: 'nostr',
        target: nostrTarget,
      },
      {
        type: 'post',
        target: httpEndpoint,
      },
    ],
  }

  return {
    request: encodePaymentRequest(paymentRequest),
    id,
    httpEndpoint,
  }
}

/**
 * Check if request has HTTP POST transport
 */
export function hasPostTransport(request: PaymentRequest): boolean {
  return request.transports.some((t) => t.type === 'post')
}

/**
 * Get HTTP POST transport target URL
 */
export function getPostTarget(request: PaymentRequest): string | null {
  const transport = request.transports.find((t) => t.type === 'post')
  return transport?.target || null
}

/**
 * Build HTTP endpoint URL for NUT-18 payment request on a mint
 */
export function buildHttpEndpoint(mintUrl: string, requestId: string): string {
  return `${mintUrl.replace(/\/$/, '')}/v1/payment-request/${requestId}`
}

/**
 * Encode a payment request to creqA... string
 */
export function encodePaymentRequest(request: PaymentRequest): string {
  const cbor: CborPaymentRequest = {
    i: request.id,
    u: request.unit,
    m: request.mints,
    t: request.transports.map((t) => ({
      t: t.type,
      a: t.target,
      ...(t.nonce ? { n: t.nonce } : {}),
    })),
  }

  // Optional fields
  if (request.amount !== undefined) {
    cbor.a = request.amount
  }
  if (request.description) {
    cbor.d = request.description
  }
  if (request.singleUse !== undefined) {
    cbor.s = request.singleUse
  }

  // Encode to CBOR
  const cborBytes = encodeCbor(cbor)

  // Convert to base64url
  const base64 = uint8ArrayToBase64Url(new Uint8Array(cborBytes))

  return `${PAYMENT_REQUEST_PREFIX}${base64}`
}

// ============= Decoding =============

/**
 * Decode a NUT-18 payment request
 * Accepts both creqA... and cashu://... formats
 */
export function decodePaymentRequest(input: string): PaymentRequest {
  const trimmed = input.trim()

  let base64Data: string

  // Handle cashu:// URI format
  if (trimmed.toLowerCase().startsWith(CASHU_URI_PREFIX)) {
    const path = trimmed.slice(CASHU_URI_PREFIX.length)
    // cashu://creqA... or cashu://pay?request=creqA...
    if (path.toLowerCase().startsWith('creqa')) {
      base64Data = path.slice(5) // Remove 'creqA'
    } else if (path.includes('request=')) {
      const match = path.match(/request=([^&]+)/)
      if (match && match[1].toLowerCase().startsWith('creqa')) {
        base64Data = match[1].slice(5)
      } else {
        throw new Error('Invalid cashu:// URI format')
      }
    } else {
      throw new Error('Invalid cashu:// URI format')
    }
  }
  // Handle creqA... format
  else if (trimmed.toLowerCase().startsWith('creqa')) {
    base64Data = trimmed.slice(5) // Remove 'creqA'
  } else {
    throw new Error('Invalid payment request format')
  }

  // Decode base64url to bytes
  const bytes = base64UrlToUint8Array(base64Data)

  // Decode CBOR
  const cbor = decodeCbor(bytes) as CborPaymentRequest

  // Validate required fields
  if (!cbor.u || !cbor.m || !cbor.t) {
    throw new Error('Invalid payment request: missing required fields')
  }

  // Parse transports
  const transports: PaymentRequestTransport[] = cbor.t.map((t) => ({
    type: t.t as TransportType,
    target: t.a,
    nonce: t.n,
  }))

  return {
    id: cbor.i || generateRequestId(),
    amount: cbor.a,
    unit: cbor.u,
    mints: cbor.m,
    description: cbor.d,
    singleUse: cbor.s ?? true,
    transports,
  }
}

/**
 * Check if a string is a valid NUT-18 payment request
 */
export function isPaymentRequest(input: string): boolean {
  const trimmed = input.trim().toLowerCase()
  return trimmed.startsWith('creqa') || trimmed.startsWith('cashu://')
}

/**
 * Get the primary transport from a payment request
 */
export function getPrimaryTransport(request: PaymentRequest): PaymentRequestTransport | null {
  // Prefer Nostr transport
  const nostrTransport = request.transports.find((t) => t.type === 'nostr')
  if (nostrTransport) return nostrTransport

  // Fall back to first transport
  return request.transports[0] || null
}

/**
 * Check if request has Nostr transport
 */
export function hasNostrTransport(request: PaymentRequest): boolean {
  return request.transports.some((t) => t.type === 'nostr')
}

/**
 * Get Nostr transport target (npub or nprofile)
 */
export function getNostrTarget(request: PaymentRequest): string | null {
  const transport = request.transports.find((t) => t.type === 'nostr')
  return transport?.target || null
}

// ============= Utilities =============

export function generateRequestId(prefix?: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const random = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)
  return prefix ? `${prefix}_${random}` : random
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function base64UrlToUint8Array(base64url: string): Uint8Array {
  // Add padding if needed
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) {
    base64 += '='
  }

  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}
