/**
 * NUT-18 / NUT-26 Payment Request Service
 * Handles encoding/decoding of Cashu payment requests with transport support
 *
 * Supports:
 * - creqA (NUT-18, CBOR base64url) — legacy, decode only
 * - creqB (NUT-26, TLV bech32m) — default encoding, compact QR
 * - cashu:// URI
 * - bitcoin: URI (BIP-321) — unified QR with lightning + ecash
 */

import {
  PaymentRequest as CashuPaymentRequest,
  PaymentRequestTransportType,
} from '@cashu/cashu-ts'

// ============= Types =============

export type TransportType = 'nostr' | 'post'

export interface PaymentRequestTransport {
  type: TransportType
  target: string // npub or nprofile for nostr, URL for post
  nonce?: string[]
}

export interface Nut10SpendingCondition {
  kind: string
  data: string
  tags?: string[][]
}

export interface PaymentRequest {
  id: string
  amount?: number
  unit: string
  mints: string[]
  description?: string
  singleUse: boolean
  transports: PaymentRequestTransport[]
  nut10?: Nut10SpendingCondition
}

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
 * Encode a payment request to creqB (NUT-26 bech32m) format.
 * creqB is more compact and QR-friendly (uppercase alphanumeric mode).
 *
 * @param format - 'creqB' (default, recommended) or 'creqA' (legacy CBOR)
 */
export function encodePaymentRequest(
  request: PaymentRequest,
  format: 'creqA' | 'creqB' = 'creqB'
): string {
  const transports = request.transports.map((t) => ({
    type: t.type === 'nostr' ? PaymentRequestTransportType.NOSTR : PaymentRequestTransportType.POST,
    target: t.target,
    ...(t.nonce ? { tags: [['n', ...t.nonce]] } : {}),
  }))

  const cashuPR = new CashuPaymentRequest(
    transports,
    request.id,
    request.amount,
    request.unit,
    request.mints,
    request.description,
    request.singleUse,
  )

  return format === 'creqA' ? cashuPR.toEncodedCreqA() : cashuPR.toEncodedCreqB()
}

// ============= Decoding =============

/**
 * Decode a payment request from any supported format:
 * - creqA... (NUT-18 CBOR)
 * - creqB... / CREQB... (NUT-26 bech32m)
 * - cashu://creqA... or cashu://creqB...
 * - bitcoin:?creq=CREQB1... (BIP-321)
 */
export function decodePaymentRequest(input: string): PaymentRequest {
  const trimmed = input.trim()

  let encoded: string

  // Handle bitcoin: URI (BIP-321)
  const bitcoinParsed = parseBitcoinUri(trimmed)
  if (bitcoinParsed?.creq) {
    encoded = bitcoinParsed.creq
  }
  // Handle cashu:// URI
  else if (trimmed.toLowerCase().startsWith('cashu://')) {
    const path = trimmed.slice('cashu://'.length)
    // cashu://creqA... or cashu://creqB...
    if (/^creq[ab]/i.test(path)) {
      encoded = path
    } else if (path.includes('request=')) {
      const match = path.match(/request=([^&]+)/)
      if (match && /^creq[ab]/i.test(match[1])) {
        encoded = match[1]
      } else {
        throw new Error('Invalid cashu:// URI format')
      }
    } else {
      throw new Error('Invalid cashu:// URI format')
    }
  }
  // Handle raw creqA.../creqB.../CREQB...
  else if (/^creq[ab]/i.test(trimmed)) {
    encoded = trimmed
  } else {
    throw new Error('Invalid payment request format')
  }

  // Delegate to cashu-ts (auto-detects creqA vs creqB)
  const cashuPR = CashuPaymentRequest.fromEncodedRequest(encoded)

  // Map to our PaymentRequest interface
  const transports: PaymentRequestTransport[] = (cashuPR.transport || []).map((t) => ({
    type: t.type === PaymentRequestTransportType.NOSTR ? 'nostr' as const : 'post' as const,
    target: t.target,
    nonce: t.tags?.find((tag) => tag[0] === 'n')?.slice(1),
  }))

  // Extract NUT-10 spending conditions (e.g., P2PK lock)
  let nut10: Nut10SpendingCondition | undefined
  if (cashuPR.nut10) {
    nut10 = {
      kind: cashuPR.nut10.kind,
      data: cashuPR.nut10.data,
      tags: cashuPR.nut10.tags,
    }
  }

  return {
    id: cashuPR.id || generateRequestId(),
    amount: cashuPR.amount,
    unit: cashuPR.unit || 'sat',
    mints: cashuPR.mints || [],
    description: cashuPR.description,
    singleUse: cashuPR.singleUse ?? true,
    transports,
    nut10,
  }
}

/**
 * Check if a string is a valid payment request (any supported format)
 */
export function isPaymentRequest(input: string): boolean {
  const trimmed = input.trim().toLowerCase()
  if (trimmed.startsWith('creqa') || trimmed.startsWith('creqb')) return true
  if (trimmed.startsWith('cashu://')) return true
  if (trimmed.startsWith('bitcoin:')) {
    const parsed = parseBitcoinUri(input.trim())
    return !!parsed?.creq
  }
  return false
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

// ============= BIP-321 Unified URI =============

/**
 * Build a BIP-321 unified bitcoin: URI combining Lightning + eCash.
 * Enables a single QR code scannable by both Lightning and Cashu wallets.
 *
 * @example
 * buildUnifiedBitcoinUri({ lightningInvoice: 'lnbc...', cashuRequest: 'CREQB1...' })
 * // => 'bitcoin:?lightning=LNBC...&creq=CREQB1...'
 */
export function buildUnifiedBitcoinUri(options: {
  lightningInvoice?: string
  cashuRequest?: string
}): string {
  const { lightningInvoice, cashuRequest } = options

  const params: string[] = []

  if (lightningInvoice) {
    // Uppercase for QR alphanumeric mode efficiency
    params.push(`lightning=${lightningInvoice.toUpperCase()}`)
  }

  if (cashuRequest) {
    // creqB is already uppercase from toEncodedCreqB()
    params.push(`creq=${cashuRequest}`)
  }

  if (params.length === 0) {
    throw new Error('At least one of lightningInvoice or cashuRequest must be provided')
  }

  return `bitcoin:?${params.join('&')}`
}

/**
 * Parse a bitcoin: URI to extract creq and lightning parameters.
 * Returns null if the input is not a bitcoin: URI.
 */
export function parseBitcoinUri(input: string): {
  creq?: string
  lightning?: string
} | null {
  if (!input.toLowerCase().startsWith('bitcoin:')) return null

  try {
    // Extract query string after 'bitcoin:' (may have address before ?)
    const queryStart = input.indexOf('?')
    if (queryStart === -1) return {}

    const queryString = input.slice(queryStart + 1)
    const params = new URLSearchParams(queryString)

    return {
      creq: params.get('creq') || undefined,
      lightning: params.get('lightning') || undefined,
    }
  } catch {
    return null
  }
}

// ============= Utilities =============

export function generateRequestId(prefix?: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  const random = Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 10)
  return prefix ? `${prefix}_${random}` : random
}
