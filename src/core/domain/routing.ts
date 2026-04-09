/**
 * Payment Routing Domain Types & Pure Functions
 *
 * Route selection algorithm and types.
 * No external dependencies — pure domain logic.
 */

import type { ValidatedData, ParsedCashuRequest } from './input-types'

// ─── Route Constants (as const for single source of truth) ───

export const PaymentRoute = {
  CANNOT_SEND: 0,
  /** #1 — same mint token transfer via NUT-18 transport (~2 sat) */
  TOKEN_TRANSFER: 1,
  /** #2 — same mint LN internal settle (~1 sat) */
  LN_INTERNAL: 2,
  /** #3 — cross mint LN payment (~4 sat) */
  LN_CROSS_MINT: 3,
  /** #4 — cross mint: melt→mint on target + send token via DM (~5 sat) */
  MINT_AND_DM: 4,
  /** #5 — direct bolt11 melt payment (~4 sat) */
  MELT_TO_LN: 5,
  /** #6 — own mint token send, creq has no m field (~2 sat) */
  OWN_MINT_TOKEN: 6,
} as const

export type PaymentRoute = (typeof PaymentRoute)[keyof typeof PaymentRoute]

export const ROUTE_LABELS: Record<PaymentRoute, string> = {
  [PaymentRoute.CANNOT_SEND]: 'Cannot send',
  [PaymentRoute.TOKEN_TRANSFER]: 'Token transfer',
  [PaymentRoute.LN_INTERNAL]: 'Lightning (internal)',
  [PaymentRoute.LN_CROSS_MINT]: 'Lightning (cross-mint)',
  [PaymentRoute.MINT_AND_DM]: 'Mint + DM',
  [PaymentRoute.MELT_TO_LN]: 'Lightning',
  [PaymentRoute.OWN_MINT_TOKEN]: 'eCash token',
}

// ─── Route Input/Output Types ───

export interface RouteSelection {
  route: PaymentRoute
  amount: number
  sourceMintUrl: string
  targetMintUrl?: string
  invoice?: string
  estimatedFee: number
  reason: string
}

export interface RouteInput {
  validatedData: ValidatedData
  senderMints: Record<string, number>
  amount: number
  privacyMode: boolean
  lightningInvoice?: string
}

export interface FeeEstimate {
  fee: number
  totalNeeded: number
}

export interface RouteContext {
  parsedCreq?: ParsedCashuRequest
  nostrPrivkey?: string
  relays?: string[]
  memo?: string
  addressOrInvoice?: string
  drain?: boolean
  outgoingTransport?: unknown
}

export interface RouteExecutionResult {
  success: boolean
  amount: number
  fee: number
  sourceMintUrl: string
  targetMintUrl?: string
  transactionId: string
  token?: string
  transportUsed?: 'nostr' | 'post' | 'none'
}

// ─── Pure Functions ───

/**
 * URI + sender context → 최적 결제 라우트 선택
 * Side effect 없음. 단위 테스트 100% 가능.
 */
export function selectRoute(input: RouteInput): PaymentRoute {
  const { validatedData, senderMints, privacyMode, lightningInvoice } = input
  const senderMintUrls = Object.keys(senderMints).filter((m) => senderMints[m] > 0)

  // Non-creq paths
  if (
    validatedData.type === 'bolt11' ||
    validatedData.type === 'lightning-address' ||
    validatedData.type === 'lnurl-pay'
  ) {
    return PaymentRoute.MELT_TO_LN
  }

  if (validatedData.type === 'my-wallet') {
    return PaymentRoute.LN_CROSS_MINT
  }

  // creq path
  if (validatedData.type !== 'cashu-request') {
    return PaymentRoute.CANNOT_SEND
  }

  const { parsed } = validatedData
  const hasMints = parsed.mints.length > 0
  const hasLn = !!lightningInvoice || !!parsed.lightningInvoice

  if (hasMints) {
    const commonMints = findCommonMints(senderMintUrls, parsed.mints)

    if (commonMints.length > 0) {
      if (privacyMode) return PaymentRoute.TOKEN_TRANSFER
      if (hasLn) return PaymentRoute.LN_INTERNAL
      return PaymentRoute.TOKEN_TRANSFER
    } else {
      if (privacyMode) return PaymentRoute.MINT_AND_DM
      if (hasLn) return PaymentRoute.LN_CROSS_MINT
      return PaymentRoute.MINT_AND_DM
    }
  } else {
    if (privacyMode) return PaymentRoute.OWN_MINT_TOKEN
    if (hasLn) return PaymentRoute.MELT_TO_LN
    return PaymentRoute.OWN_MINT_TOKEN
  }
}

/**
 * 라우트에 따라 최적 source mint 선택.
 * Best-fit: smallest balance >= amount
 */
export function selectSourceMint(
  route: PaymentRoute,
  senderMints: Record<string, number>,
  amount: number,
  commonMints?: string[],
): string | null {
  if (
    (route === PaymentRoute.TOKEN_TRANSFER || route === PaymentRoute.LN_INTERNAL) &&
    commonMints &&
    commonMints.length > 0
  ) {
    return bestFitMint(senderMints, amount, commonMints)
  }
  return bestFitMint(senderMints, amount)
}

/**
 * sender mints ∩ receiver mints
 */
export function findCommonMints(senderMints: string[], receiverMints: string[]): string[] {
  const receiverSet = new Set(receiverMints.map(normalizeUrl))
  return senderMints.filter((m) => receiverSet.has(normalizeUrl(m)))
}

// ─── Internal Helpers ───

function bestFitMint(
  mints: Record<string, number>,
  amount: number,
  candidates?: string[],
): string | null {
  const pool = candidates ? candidates.filter((m) => m in mints) : Object.keys(mints)

  const sufficient = pool.filter((m) => mints[m] >= amount).sort((a, b) => mints[a] - mints[b])

  if (sufficient.length > 0) return sufficient[0]

  const fallback = [...pool].sort((a, b) => mints[b] - mints[a])
  return fallback[0] || null
}

function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, '').toLowerCase()
}
