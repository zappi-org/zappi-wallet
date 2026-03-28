/**
 * Input Validator for Unified Scanner
 * Performs async validation for detected input types
 */

import i18n from '@/i18n'
import { resolveLightningAddress, type LnurlPayParams } from '@/services/lnurl'
import { bech32 } from '@scure/base'
import { decodePaymentRequest } from '@/services/cashu/nut18'
import type {
  InputType,
  Bolt11Input,
  LightningAddressInput,
  LnurlInput,
  CashuTokenInput,
  CashuRequestInput,
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
  | ValidatedMyWallet
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
  hasPostTransport: boolean
  postTarget?: string  // HTTP POST endpoint URL
  p2pkPubkey?: string  // extracted from nut10 when kind === 'P2PK'
  /** Bolt11 from unified bitcoin: URI (routing layer에서 사용) */
  lightningInvoice?: string
}

export interface ValidatedMyWallet {
  type: 'my-wallet'
  targetMintUrl: string
  targetMintName: string
}

export interface ValidatedNpubContact {
  type: 'npub-contact'
  npub: string
  pubkeyHex: string
  contactName: string
  mints: string[]
  relays?: string[]
  p2pkPubkey?: string
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
  return ['lightning-address', 'lnurl'].includes(type)
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
    const parsed = decodeCashuRequest(input.request, input.lightningInvoice)
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
 * Decode payment request (NUT-18 creqA / NUT-26 creqB / cashu:// / bitcoin:)
 * Delegates to nut18.ts which uses cashu-ts PaymentRequest class
 */
export function decodeCashuRequest(request: string, lightningInvoice?: string): ParsedCashuRequest {
  const decoded = decodePaymentRequest(request)

  const transports: CashuRequestTransport[] = decoded.transports.map((t) => ({
    type: t.type,
    target: t.target,
  }))

  const nostrTransport = transports.find((t) => t.type === 'nostr')
  const postTransport = transports.find((t) => t.type === 'post')

  // Extract NUT-10 spending conditions (P2PK lock)
  let nut10: { kind: string; data: string; tags?: string[][] } | undefined
  let p2pkPubkey: string | undefined
  if (decoded.nut10) {
    nut10 = decoded.nut10
    if (nut10.kind === 'P2PK' && nut10.data) {
      if (/^(02|03)[0-9a-fA-F]{64}$/.test(nut10.data)) {
        p2pkPubkey = nut10.data
      }
    }
  }

  return {
    id: decoded.id,
    amount: decoded.amount,
    unit: decoded.unit,
    mints: decoded.mints,
    singleUse: decoded.singleUse,
    description: decoded.description,
    transports,
    nut10,
    hasNostrTransport: !!nostrTransport,
    nostrTarget: nostrTransport?.target,
    hasPostTransport: !!postTransport,
    postTarget: postTransport?.target,
    p2pkPubkey,
    lightningInvoice,
  }
}

