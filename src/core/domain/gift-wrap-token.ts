/**
 * gift-wrap-token — parse unwrapped NIP-17 message content into token candidates.
 *
 * Pure domain logic only. Token encoding stays behind TokenCodec adapters.
 */

import { parseDirectToken } from './direct-token'
import type { CashuProof } from './cashu-payment-payload'

export type GiftWrapTokenCandidate =
  | {
      kind: 'encoded-token'
      token: string
      txId: string
      requestId?: string
      memo?: string
      metadata?: Record<string, unknown>
      mintUrl?: string
      amount?: number
    }
  | {
      kind: 'cashu-json'
      mint: string
      unit?: string
      proofs: CashuProof[]
      txId: string
      requestId?: string
      memo?: string
      metadata?: Record<string, unknown>
    }

interface Nut18TokenMessage {
  type: 'cashu_token'
  token: string
  memo?: string
  request_id?: string
}

interface CashuJsonToken {
  id?: string
  mint?: string
  unit?: string
  proofs: CashuProof[]
  txId?: string
  memo?: string
  metadata?: Record<string, unknown>
}

export function parseGiftWrapTokenContent(
  content: string,
  eventId: string,
  opts?: { pendingRequestId?: string | null },
): GiftWrapTokenCandidate | null {
  const trimmed = content.trim()

  if (isRawCashuToken(trimmed)) {
    return {
      kind: 'encoded-token',
      token: trimmed,
      txId: `dm-token-${eventId.slice(0, 12)}`,
      requestId: opts?.pendingRequestId ?? undefined,
    }
  }

  let msg: unknown
  try {
    msg = JSON.parse(trimmed)
  } catch {
    return null
  }

  const legacyDirectToken = parseDirectTokenSafe(msg)
  if (legacyDirectToken) {
    return {
      kind: 'encoded-token',
      token: legacyDirectToken.token,
      txId: `direct-token-${eventId.slice(0, 12)}`,
      memo: legacyDirectToken.memo,
      mintUrl: legacyDirectToken.mintUrl,
      amount: legacyDirectToken.amount,
    }
  }

  if (isNut18TokenMessage(msg)) {
    return {
      kind: 'encoded-token',
      token: msg.token,
      txId: msg.request_id || `nut18-${eventId.slice(0, 12)}`,
      requestId: msg.request_id,
      memo: msg.memo,
    }
  }

  if (isCashuJsonToken(msg)) {
    const mint = msg.mint || ''
    if (!mint) return null

    return {
      kind: 'cashu-json',
      mint,
      unit: msg.unit,
      proofs: msg.proofs,
      txId: msg.txId || msg.id || `v4json-${eventId.slice(0, 12)}`,
      requestId: msg.id,
      memo: msg.memo,
      metadata: msg.metadata,
    }
  }

  if (isPaymentFulfillment(msg)) {
    return {
      kind: 'encoded-token',
      token: msg.content.token,
      txId: msg.content.tx_id,
    }
  }

  return null
}

export function candidateAmount(candidate: GiftWrapTokenCandidate): number | undefined {
  if (candidate.kind === 'encoded-token') return candidate.amount
  return candidate.proofs.reduce((sum, proof) => sum + Number(proof.amount), 0)
}

export function candidateMintUrl(candidate: GiftWrapTokenCandidate): string | undefined {
  return candidate.kind === 'encoded-token' ? candidate.mintUrl : candidate.mint
}

function isRawCashuToken(content: string): boolean {
  return /^cashu[ab]/i.test(content)
}

function parseDirectTokenSafe(msg: unknown) {
  if (!isDirectTokenRumor(msg)) return null
  return parseDirectToken(msg)
}

function isDirectTokenRumor(msg: unknown): msg is Parameters<typeof parseDirectToken>[0] {
  return (
    isObject(msg) &&
    typeof msg.kind === 'number' &&
    Array.isArray(msg.tags) &&
    msg.tags.every((tag) => Array.isArray(tag) && tag.every((item) => typeof item === 'string')) &&
    typeof msg.content === 'string' &&
    typeof msg.pubkey === 'string' &&
    typeof msg.created_at === 'number'
  )
}

function isNut18TokenMessage(msg: unknown): msg is Nut18TokenMessage {
  return (
    isObject(msg) &&
    msg.type === 'cashu_token' &&
    typeof msg.token === 'string'
  )
}

function isCashuJsonToken(msg: unknown): msg is CashuJsonToken {
  return (
    isObject(msg) &&
    Array.isArray(msg.proofs) &&
    msg.proofs.length > 0 &&
    isObject(msg.proofs[0]) &&
    typeof msg.proofs[0].C === 'string'
  )
}

function isPaymentFulfillment(msg: unknown): msg is { type: 'payment_fulfillment'; content: { token: string; tx_id: string } } {
  return (
    isObject(msg) &&
    msg.type === 'payment_fulfillment' &&
    isObject(msg.content) &&
    typeof msg.content.token === 'string' &&
    typeof msg.content.tx_id === 'string'
  )
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
