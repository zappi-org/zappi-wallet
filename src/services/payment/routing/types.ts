/**
 * Payment Routing Types
 *
 * 6가지 결제 경로 타입과 라우팅 입출력 인터페이스 정의.
 * Cashu Fee-Optimal Routing spec (ZAP-86) 기반.
 */

import type { ValidatedData, ParsedCashuRequest } from '@/ui/components/scanner/InputValidator'

// ============= Route Enum =============

export enum PaymentRoute {
  CANNOT_SEND = 0,
  /** #1 — same mint token transfer via NUT-18 transport (~2 sat) */
  TOKEN_TRANSFER = 1,
  /** #2 — same mint LN internal settle (~1 sat) */
  LN_INTERNAL = 2,
  /** #3 — cross mint LN payment (~4 sat) */
  LN_CROSS_MINT = 3,
  /** #4 — cross mint: melt→mint on target + send token via DM (~5 sat) */
  MINT_AND_DM = 4,
  /** #5 — direct bolt11 melt payment (~4 sat) */
  MELT_TO_LN = 5,
  /** #6 — own mint token send, creq has no m field (~2 sat) */
  OWN_MINT_TOKEN = 6,
}

// ============= Route Selection =============

export interface RouteSelection {
  route: PaymentRoute
  /** Amount to send in sats */
  amount: number
  /** Source mint URL (sender pays from here) */
  sourceMintUrl: string
  /** Target mint URL — Routes 1-4 */
  targetMintUrl?: string
  /** Bolt11 invoice — Routes 2,3,5 */
  invoice?: string
  /** Estimated fee in sats */
  estimatedFee: number
  /** Debug/log reason for this route selection */
  reason: string
}

// ============= Route Input =============

export interface RouteInput {
  /** Validated input from InputValidator */
  validatedData: ValidatedData
  /** Sender's mints with balances: { mintUrl: balance } */
  senderMints: Record<string, number>
  /** Amount to send in sats */
  amount: number
  /** Privacy mode preference (default: false) */
  privacyMode: boolean
  /** Bolt11 from bitcoin: URI's lightning= field (unified QR) */
  lightningInvoice?: string
}

// ============= Route Execution =============

export interface RouteContext {
  /** Parsed creq data (for token routes) */
  parsedCreq?: ParsedCashuRequest
  /** Nostr private key for DM transport */
  nostrPrivkey?: string
  /** Relay URLs for Nostr transport */
  relays?: string[]
  /** Memo / description */
  memo?: string
  /** Address or invoice string (for display / LN resolution) */
  addressOrInvoice?: string
  /** Drain mode (for TransferScreen) */
  drain?: boolean
}

export interface RouteExecutionResult {
  success: boolean
  amount: number
  fee: number
  sourceMintUrl: string
  targetMintUrl?: string
  transactionId: string
  /** Token string (for token routes) */
  token?: string
  /** Which transport was used */
  transportUsed?: 'nostr' | 'post' | 'none'
}

// Debug labels, not user-facing

export const ROUTE_LABELS: Record<PaymentRoute, string> = {
  [PaymentRoute.CANNOT_SEND]: 'Cannot send',
  [PaymentRoute.TOKEN_TRANSFER]: 'Token transfer',
  [PaymentRoute.LN_INTERNAL]: 'Lightning (internal)',
  [PaymentRoute.LN_CROSS_MINT]: 'Lightning (cross-mint)',
  [PaymentRoute.MINT_AND_DM]: 'Mint + DM',
  [PaymentRoute.MELT_TO_LN]: 'Lightning',
  [PaymentRoute.OWN_MINT_TOKEN]: 'eCash token',
}
