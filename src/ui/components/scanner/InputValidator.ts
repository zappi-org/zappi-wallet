/**
 * Input Validator for Unified Scanner
 * Performs async validation for detected input types
 */

import i18n from '@/i18n'
import { resolveLightningAddress, type LnurlPayParams } from '@/services/lnurl'
import { bech32 } from '@scure/base'
import { decode as decodeCbor } from 'cbor-x'
import type {
  InputType,
  Bolt11Input,
  LightningAddressInput,
  LnurlInput,
  CashuTokenInput,
  CashuRequestInput,
  NostrPubkeyInput,
  NostrEventInput,
} from './InputTypeDetector'

// ============= Validation Result Types =============

export type ValidationResult =
  | ValidationSuccess
  | ValidationError

export interface ValidationSuccess {
  valid: true
  data: ValidatedData
}

export interface ValidationError {
  valid: false
  error: string
  errorCode: ValidationErrorCode
}

export type ValidationErrorCode =
  | 'EXPIRED'
  | 'INVALID_ADDRESS'
  | 'INVALID_LNURL'
  | 'INVALID_TOKEN'
  | 'INVALID_REQUEST'
  | 'INVALID_NOSTR'
  | 'OFFLINE'
  | 'UNKNOWN'

// ============= Validated Data Types =============

export type ValidatedData =
  | ValidatedBolt11
  | ValidatedLightningAddress
  | ValidatedLnurlPay
  | ValidatedLnurlWithdraw
  | ValidatedCashuToken
  | ValidatedCashuRequest
  | ValidatedNostrPubkey
  | ValidatedNostrEvent
  | ValidatedAmount

export interface ValidatedBolt11 {
  type: 'bolt11'
  invoice: string
  amountSats: number
  description?: string
  expiry: number
  paymentHash?: string
}

export interface ValidatedLightningAddress {
  type: 'lightning-address'
  address: string
  lnurlParams: LnurlPayParams
}

export interface ValidatedLnurlPay {
  type: 'lnurl-pay'
  lnurl: string
  params: LnurlPayParams
}

export interface ValidatedLnurlWithdraw {
  type: 'lnurl-withdraw'
  lnurl: string
  params: LnurlWithdrawParams
}

export interface LnurlWithdrawParams {
  callback: string
  k1: string
  minWithdrawable: number
  maxWithdrawable: number
  defaultDescription?: string
  domain: string
}

export interface ValidatedCashuToken {
  type: 'cashu-token'
  token: string
  amountSats: number
  mintUrl: string
  memo?: string
}

export interface ValidatedCashuRequest {
  type: 'cashu-request'
  request: string
  parsed: ParsedCashuRequest
}

export interface CashuRequestTransport {
  type: 'nostr' | 'post' | string
  target: string // npub for nostr, URL for post
}

export interface ParsedCashuRequest {
  id: string
  amount?: number
  unit: string
  mints: string[]
  singleUse?: boolean
  description?: string
  transports: CashuRequestTransport[]
  // NUT-10 spending conditions
  nut10?: { kind: string; data: string; tags?: string[][] }
  // Convenience accessors
  hasNostrTransport: boolean
  nostrTarget?: string // npub or hex pubkey for nostr transport
  p2pkPubkey?: string  // extracted from nut10 when kind === 'P2PK'
}

export interface ValidatedNostrPubkey {
  type: 'nostr-pubkey'
  input: string
  pubkey: string
  relays?: string[]
}

export interface ValidatedNostrEvent {
  type: 'nostr-event'
  input: string
  eventId: string
  pubkey?: string
  relays?: string[]
}

export interface ValidatedAmount {
  type: 'amount'
  amount: number
}

// ============= Validation Functions =============

/**
 * Validate the detected input type
 * This is an async function that performs network validation if needed
 */
export async function validateInput(input: InputType): Promise<ValidationResult> {
  // Check online status for network-required validations
  if (requiresNetwork(input.type) && !navigator.onLine) {
    return {
      valid: false,
      error: i18n.t('scanner.offlineError'),
      errorCode: 'OFFLINE',
    }
  }

  switch (input.type) {
    case 'bolt11':
      return validateBolt11(input)
    case 'lightning-address':
      return validateLightningAddress(input)
    case 'lnurl':
      return validateLnurl(input)
    case 'cashu-token':
      return validateCashuToken(input)
    case 'cashu-request':
      return validateCashuRequest(input)
    case 'nostr-pubkey':
      return validateNostrPubkey(input)
    case 'nostr-event':
      return validateNostrEvent(input)
    case 'amount':
      return {
        valid: true,
        data: { type: 'amount', amount: input.amount },
      }
    case 'unknown':
      return {
        valid: false,
        error: i18n.t('scanner.unrecognizedFormat'),
        errorCode: 'UNKNOWN',
      }
  }
}

function requiresNetwork(type: InputType['type']): boolean {
  return ['lightning-address', 'lnurl', 'nostr-pubkey', 'nostr-event'].includes(type)
}

// ============= Individual Validators =============

function validateBolt11(input: Bolt11Input): ValidationResult {
  if (input.isExpired) {
    return {
      valid: false,
      error: i18n.t('scanner.invoiceExpired'),
      errorCode: 'EXPIRED',
    }
  }

  return {
    valid: true,
    data: {
      type: 'bolt11',
      invoice: input.invoice,
      amountSats: input.amountSats,
      description: input.description,
      expiry: input.expiry,
      paymentHash: input.paymentHash,
    },
  }
}

async function validateLightningAddress(input: LightningAddressInput): Promise<ValidationResult> {
  try {
    const params = await resolveLightningAddress(input.address)
    return {
      valid: true,
      data: {
        type: 'lightning-address',
        address: input.address,
        lnurlParams: params,
      },
    }
  } catch {
    return {
      valid: false,
      error: i18n.t('scanner.invalidAddress'),
      errorCode: 'INVALID_ADDRESS',
    }
  }
}

async function validateLnurl(input: LnurlInput): Promise<ValidationResult> {
  try {
    // Decode LNURL using bech32
    const { words } = bech32.decode(input.lnurl as `${string}1${string}`, 2000)
    const data = bech32.fromWords(words)
    const url = new TextDecoder().decode(new Uint8Array(data))

    // Fetch LNURL endpoint
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`LNURL fetch failed: ${response.status}`)
    }

    const lnurlData = await response.json()

    if (lnurlData.status === 'ERROR') {
      throw new Error(lnurlData.reason || 'LNURL error')
    }

    // Determine type based on tag
    if (lnurlData.tag === 'payRequest') {
      return {
        valid: true,
        data: {
          type: 'lnurl-pay',
          lnurl: input.lnurl,
          params: {
            callback: lnurlData.callback,
            minSendable: lnurlData.minSendable,
            maxSendable: lnurlData.maxSendable,
            metadata: lnurlData.metadata,
            commentAllowed: lnurlData.commentAllowed,
            tag: 'payRequest',
            domain: new URL(url).hostname,
            allowsNostr: lnurlData.allowsNostr,
            nostrPubkey: lnurlData.nostrPubkey,
            payerData: lnurlData.payerData,
          },
        },
      }
    } else if (lnurlData.tag === 'withdrawRequest') {
      return {
        valid: true,
        data: {
          type: 'lnurl-withdraw',
          lnurl: input.lnurl,
          params: {
            callback: lnurlData.callback,
            k1: lnurlData.k1,
            minWithdrawable: lnurlData.minWithdrawable,
            maxWithdrawable: lnurlData.maxWithdrawable,
            defaultDescription: lnurlData.defaultDescription,
            domain: new URL(url).hostname,
          },
        },
      }
    } else {
      throw new Error(`Unsupported LNURL tag: ${lnurlData.tag}`)
    }
  } catch {
    return {
      valid: false,
      error: i18n.t('scanner.lnurlError'),
      errorCode: 'INVALID_LNURL',
    }
  }
}

function validateCashuToken(input: CashuTokenInput): ValidationResult {
  // Token was already decoded in detectInputType
  // Just validate it has meaningful data
  if (!input.mintUrl || input.amountSats <= 0) {
    return {
      valid: false,
      error: i18n.t('scanner.invalidToken'),
      errorCode: 'INVALID_TOKEN',
    }
  }

  return {
    valid: true,
    data: {
      type: 'cashu-token',
      token: input.token,
      amountSats: input.amountSats,
      mintUrl: input.mintUrl,
      memo: input.memo,
    },
  }
}

function validateCashuRequest(input: CashuRequestInput): ValidationResult {
  try {
    const parsed = decodeCashuRequest(input.request)
    return {
      valid: true,
      data: {
        type: 'cashu-request',
        request: input.request,
        parsed,
      },
    }
  } catch {
    return {
      valid: false,
      error: i18n.t('scanner.invalidCashuRequest'),
      errorCode: 'INVALID_REQUEST',
    }
  }
}

/**
 * Decode NUT-18 Payment Request
 * Supports both creqA... and cashu:// formats
 * NUT-18 uses CBOR encoding for the payload
 */
function decodeCashuRequest(request: string): ParsedCashuRequest {
  let base64Data: string

  if (request.toLowerCase().startsWith('cashu://')) {
    // cashu:// URI format - handle both path and query formats
    const uriContent = request.slice(8) // Remove 'cashu://'
    if (uriContent.toLowerCase().startsWith('creqa')) {
      base64Data = uriContent.slice(5) // Remove 'creqA'
    } else if (uriContent.includes('request=')) {
      const match = uriContent.match(/request=([^&]+)/i)
      if (match && match[1].toLowerCase().startsWith('creqa')) {
        base64Data = match[1].slice(5)
      } else {
        throw new Error('Invalid cashu:// URI format')
      }
    } else {
      throw new Error('Invalid cashu:// URI format')
    }
  } else if (request.toLowerCase().startsWith('creqa')) {
    // creqA... format
    base64Data = request.slice(5) // Remove 'creqA' prefix
  } else {
    throw new Error('Unknown Cashu request format')
  }

  // Base64url decode to bytes
  let padded = base64Data.replace(/-/g, '+').replace(/_/g, '/')
  // Add padding if needed
  while (padded.length % 4) {
    padded += '='
  }
  const binaryString = atob(padded)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }

  // Decode CBOR
  const data = decodeCbor(bytes)

  // NUT-18 CBOR structure:
  // i = id (optional)
  // a = amount (optional)
  // u = unit (default: sat)
  // m = mints (array of URLs)
  // d = description (optional)
  // s = single_use (optional, default: true)
  // t = transport (array of transport objects)
  // - t.t = transport type ("nostr", "post")
  // - t.a = address (npub for nostr, URL for post)

  // Parse transport array
  const transports: CashuRequestTransport[] = []
  if (data.t && Array.isArray(data.t)) {
    for (const t of data.t) {
      transports.push({
        type: t.t || 'unknown',
        target: t.a || '',
      })
    }
  }

  // Find nostr transport
  const nostrTransport = transports.find((t) => t.type === 'nostr')

  // Parse NUT-10 spending conditions (e.g., P2PK lock)
  let nut10: { kind: string; data: string; tags?: string[][] } | undefined
  let p2pkPubkey: string | undefined
  if (data.nut10 && typeof data.nut10 === 'object') {
    nut10 = {
      kind: data.nut10.k || '',
      data: data.nut10.d || '',
      tags: data.nut10.t,
    }
    if (nut10.kind === 'P2PK' && nut10.data) {
      // Validate compressed secp256k1 pubkey: 02/03 prefix + 64 hex chars
      if (/^(02|03)[0-9a-fA-F]{64}$/.test(nut10.data)) {
        p2pkPubkey = nut10.data
      } else {
        console.warn('[InputValidator] Invalid P2PK pubkey format:', nut10.data)
      }
    }
  }

  // Generate an ID from data or use provided
  const id = data.i || `req-${Date.now().toString(36)}`

  return {
    id,
    amount: data.a,
    unit: data.u || 'sat',
    mints: data.m || [],
    singleUse: data.s ?? true,
    description: data.d,
    transports,
    nut10,
    hasNostrTransport: !!nostrTransport,
    nostrTarget: nostrTransport?.target,
    p2pkPubkey,
  }
}

async function validateNostrPubkey(input: NostrPubkeyInput): Promise<ValidationResult> {
  try {
    const { pubkey, relays } = decodeNostrEntity(input.input)
    return {
      valid: true,
      data: {
        type: 'nostr-pubkey',
        input: input.input,
        pubkey,
        relays,
      },
    }
  } catch {
    return {
      valid: false,
      error: i18n.t('scanner.invalidNostrProfile'),
      errorCode: 'INVALID_NOSTR',
    }
  }
}

async function validateNostrEvent(input: NostrEventInput): Promise<ValidationResult> {
  try {
    const { eventId, pubkey, relays } = decodeNostrEntity(input.input)
    return {
      valid: true,
      data: {
        type: 'nostr-event',
        input: input.input,
        eventId: eventId!,
        pubkey,
        relays,
      },
    }
  } catch {
    return {
      valid: false,
      error: i18n.t('scanner.invalidNostrEvent'),
      errorCode: 'INVALID_NOSTR',
    }
  }
}

/**
 * Decode Nostr bech32 entities (npub, nprofile, nevent, note)
 */
function decodeNostrEntity(input: string): {
  pubkey: string
  eventId?: string
  relays?: string[]
} {
  const { prefix, words } = bech32.decode(input as `${string}1${string}`, 5000)
  const data = new Uint8Array(bech32.fromWords(words))

  if (prefix === 'npub') {
    // npub is just a 32-byte pubkey
    return {
      pubkey: bytesToHex(data),
    }
  }

  if (prefix === 'note') {
    // note is just a 32-byte event id
    return {
      pubkey: '',
      eventId: bytesToHex(data),
    }
  }

  // nprofile and nevent use TLV encoding
  const tlv = parseTLV(data)

  if (prefix === 'nprofile') {
    const pubkeyData = tlv[0]?.[0] || new Uint8Array()
    return {
      pubkey: bytesToHex(pubkeyData),
      relays: tlv[1]?.map((r: Uint8Array) => new TextDecoder().decode(r)),
    }
  }

  if (prefix === 'nevent') {
    const eventIdData = tlv[0]?.[0] || new Uint8Array()
    const pubkeyData = tlv[2]?.[0]
    return {
      eventId: bytesToHex(eventIdData),
      relays: tlv[1]?.map((r: Uint8Array) => new TextDecoder().decode(r)),
      pubkey: pubkeyData ? bytesToHex(pubkeyData) : '',
    }
  }

  throw new Error(`Unsupported Nostr prefix: ${prefix}`)
}

function parseTLV(data: Uint8Array): Record<number, Uint8Array[]> {
  const result: Record<number, Uint8Array[]> = {}
  let i = 0

  while (i < data.length) {
    const type = data[i]
    const length = data[i + 1]
    const value = data.slice(i + 2, i + 2 + length)

    if (!result[type]) {
      result[type] = []
    }
    result[type].push(value)

    i += 2 + length
  }

  return result
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
