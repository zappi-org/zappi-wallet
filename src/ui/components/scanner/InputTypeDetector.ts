/**
 * Input Type Detector for Unified Scanner
 * Detects the type of input (invoice, address, token, etc.) and extracts relevant data
 */

import { isBolt11Invoice, decodeInvoice, isValidLightningAddress } from '@/services/lightning'
import { getDecodedToken } from '@cashu/cashu-ts'
import { parseBitcoinUri } from '@/services/cashu/nut18'

// ============= Types =============

export type InputType =
  | Bolt11Input
  | LightningAddressInput
  | LnurlInput
  | CashuTokenInput
  | CashuRequestInput
  | AmountInput
  | UnknownInput

export interface Bolt11Input {
  type: 'bolt11'
  invoice: string
  amountSats: number
  description?: string
  isExpired: boolean
  expiry: number
  paymentHash?: string
}

export interface LightningAddressInput {
  type: 'lightning-address'
  address: string
}

export interface LnurlInput {
  type: 'lnurl'
  lnurl: string
  // Note: pay/withdraw determination requires async decode
}

export interface CashuTokenInput {
  type: 'cashu-token'
  token: string
  amountSats: number
  mintUrl: string
  memo?: string
}

export interface CashuRequestInput {
  type: 'cashu-request'
  request: string
  // Parsed data will be added by validator
}

export interface AmountInput {
  type: 'amount'
  amount: number
}

export interface UnknownInput {
  type: 'unknown'
  input: string
}

// ============= Detection Functions =============

/**
 * Detect the type of input and return parsed data
 * This is a synchronous function that only does local parsing
 */
export function detectInputType(input: string): InputType {
  const trimmed = input.trim()
  if (!trimmed) {
    return { type: 'unknown', input: '' }
  }

  const normalized = trimmed.toLowerCase()

  // 1. bitcoin: URI (BIP-321) — must check before bolt11
  if (normalized.startsWith('bitcoin:')) {
    return detectBitcoinUri(trimmed)
  }

  // 2. BOLT11 Invoice
  if (isBolt11Invoice(trimmed)) {
    return detectBolt11(trimmed)
  }

  // 2. Lightning Address (user@domain.com)
  if (isValidLightningAddress(trimmed)) {
    return {
      type: 'lightning-address',
      address: trimmed,
    }
  }

  // 3. LNURL (lnurl1...)
  if (normalized.startsWith('lnurl1')) {
    return {
      type: 'lnurl',
      lnurl: trimmed,
    }
  }

  // 4. Cashu Token (cashuA..., cashuB...)
  if (/^cashu[ab]/i.test(trimmed)) {
    return detectCashuToken(trimmed)
  }

  // 5. Cashu Request / NUT-18/NUT-26 (creqA..., creqB..., CREQB..., cashu://)
  if (/^creq[ab]/i.test(trimmed) || normalized.startsWith('cashu://')) {
    return {
      type: 'cashu-request',
      request: trimmed,
    }
  }

  // 6. Pure number (amount)
  if (/^\d+$/.test(trimmed)) {
    const amount = parseInt(trimmed, 10)
    if (amount > 0 && amount <= 999999999) {
      return {
        type: 'amount',
        amount,
      }
    }
  }

  // 7. Unknown
  return {
    type: 'unknown',
    input: trimmed,
  }
}

/**
 * Detect and parse BOLT11 invoice
 */
function detectBolt11(invoice: string): Bolt11Input | UnknownInput {
  try {
    const decoded = decodeInvoice(invoice)
    return {
      type: 'bolt11',
      invoice,
      amountSats: decoded.amountSats,
      description: decoded.description,
      isExpired: decoded.isExpired,
      expiry: decoded.expiry,
      paymentHash: decoded.paymentHash,
    }
  } catch {
    return {
      type: 'unknown',
      input: invoice,
    }
  }
}

/**
 * Detect and parse Cashu token
 */
function detectCashuToken(token: string): CashuTokenInput | UnknownInput {
  try {
    const decoded = getDecodedToken(token)

    // Calculate total amount from proofs
    const totalAmount = decoded.proofs.reduce((sum, proof) => sum + proof.amount, 0)
    const mintUrl = decoded.mint

    return {
      type: 'cashu-token',
      token,
      amountSats: totalAmount,
      mintUrl,
      memo: decoded.memo,
    }
  } catch {
    return {
      type: 'unknown',
      input: token,
    }
  }
}

/**
 * Detect bitcoin: URI (BIP-321)
 * - bitcoin:?creq=CREQB1... → cashu-request (extract creq)
 * - bitcoin:?lightning=LNBC... (no creq) → bolt11 (extract lightning)
 * - bitcoin:?lightning=...&creq=... → cashu-request (creq takes priority, unified QR)
 */
function detectBitcoinUri(uri: string): InputType {
  const parsed = parseBitcoinUri(uri)
  if (!parsed) {
    return { type: 'unknown', input: uri }
  }

  // If creq is present, treat as cashu request (unified QR or standalone)
  if (parsed.creq) {
    return {
      type: 'cashu-request',
      request: parsed.creq,
    }
  }

  // If only lightning, treat as bolt11
  if (parsed.lightning) {
    return detectBolt11(parsed.lightning)
  }

  return { type: 'unknown', input: uri }
}

// ============= Helper Functions =============

/**
 * Check if the detected type requires network validation
 */
export function requiresNetworkValidation(type: InputType['type']): boolean {
  return [
    'lightning-address',
    'lnurl',
  ].includes(type)
}

/**
 * Check if the detected type can proceed offline (local decode only)
 */
export function canProceedOffline(type: InputType['type']): boolean {
  return [
    'bolt11',
    'cashu-token',
    'cashu-request',
    'amount',
  ].includes(type)
}

/**
 * Get human-readable name for input type
 */
export function getInputTypeName(type: InputType['type']): string {
  const names: Record<InputType['type'], string> = {
    'bolt11': 'Lightning Invoice',
    'lightning-address': 'Lightning Address',
    'lnurl': 'LNURL',
    'cashu-token': 'Cashu Token',
    'cashu-request': 'Cashu Request',
    'amount': 'Amount',
    'unknown': 'Unknown',
  }
  return names[type] || 'Unknown'
}
