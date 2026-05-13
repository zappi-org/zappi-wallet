/**
 * Input parsing and validation domain types.
 *
 * All types are pure — no external npm dependencies.
 * Moved from ui/components/scanner/ to enable proper hex layer access.
 */

import type { Amount } from './amount'

// ─── LNURL Types (originally in services/lnurl and ports/driven/lnurl-gateway) ───

export interface LnurlPayParams {
  callback: string
  minSendable: number
  maxSendable: number
  metadata: string
  commentAllowed?: number
  tag: 'payRequest'
  domain: string
  allowsNostr?: boolean
  nostrPubkey?: string
  payerData?: Record<string, unknown>
}

export interface LnurlWithdrawParams {
  callback: string
  k1: string
  minWithdrawable: number
  maxWithdrawable: number
  defaultDescription?: string
  domain: string
}

// ─── Input Detection Types ───

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
}

export interface CashuTokenInput {
  type: 'cashu-token'
  token: string
  amount: Amount
  mintUrl: string
  memo?: string
}

export interface CashuRequestInput {
  type: 'cashu-request'
  request: string
  lightningInvoice?: string
}

export interface AmountInput {
  type: 'amount'
  amount: number
}

export interface UnknownInput {
  type: 'unknown'
  input: string
}

// ─── Validated Data Types ───

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

export interface ValidatedCashuToken {
  type: 'cashu-token'
  token: string
  amount: Amount
  mintUrl: string
  memo?: string
}

export interface ValidatedCashuRequest {
  type: 'cashu-request'
  request: string
  parsed: ParsedCashuRequest
}

export interface ValidatedMyWallet {
  type: 'my-wallet'
  targetMintUrl: string
  targetMintName: string
}

export interface ValidatedAmount {
  type: 'amount'
  amount: number
}

// ─── Cashu Request Parsing Types ───

export interface CashuRequestTransport {
  type: 'nostr' | 'post' | string
  target: string
}

export interface ParsedCashuRequest {
  id: string
  amount?: number
  unit: string
  mints: string[]
  singleUse?: boolean
  description?: string
  transports: CashuRequestTransport[]
  nut10?: { kind: string; data: string; tags?: string[][] }
  hasNostrTransport: boolean
  nostrTarget?: string
  hasPostTransport: boolean
  postTarget?: string
  p2pkPubkey?: string
  lightningInvoice?: string
  /** Direct recipient sends must not fall back to cross-mint mint+DM routing. */
  sameMintOnly?: boolean
}
