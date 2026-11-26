import type { JsonValue } from '@/core/domain/json'
import type { OnchainPayoutStage } from '@/core/domain/onchain-payout'

export interface OnchainPayoutLimits {
  minAmount: number
  maxAmount: number
}

export interface OnchainPayoutPaymentRequest {
  request: string
  amount: number
}

export interface OnchainPayoutDeadline {
  blockHeight: number
  estimatedAt: number
}

export interface OnchainPayoutOffer {
  offerId: string
  identifier: string
  feePercent: number
  networkFee: number
  payoutFeeRate: number
  payoutFeeEstimate: number
  minAmount: number
  maxAmount: number
  seenAt: number
}

export interface OnchainPayoutQuote {
  providerId: string
  offerId: string
  identifier: string
  destination: string
  sendAmount: number
  receiveAmount: number
  serviceFee: number
  networkFee: number
  sweepFee: number
  limits: OnchainPayoutLimits
  estimatedMinutes: number
  offerRef: JsonValue
  expiresAt: number
}

export interface OnchainPayoutStartResult {
  providerRef: JsonValue
  secrets: string
  paymentRequests: OnchainPayoutPaymentRequest[]
  sendAmount: number
  receiveAmount: number
  deadline: OnchainPayoutDeadline
}

export interface OnchainPayoutProgress {
  stage: OnchainPayoutStage
  payoutTxId?: string
  failureReason?: string
  confirmations?: number
  currentHeight?: number
}

export interface OnchainPayoutAdvance {
  progress: OnchainPayoutProgress
  prepared?: { secrets: string; payoutTxId: string }
}

export interface OnchainPayoutProvider {
  readonly id: string
  listOffers(): Promise<OnchainPayoutOffer[]>
  quote(params: {
    offerId: string
    sendAmount: number
    destination: string
  }): Promise<OnchainPayoutQuote>
  start(params: { quote: OnchainPayoutQuote }): Promise<OnchainPayoutStartResult>
  resume(params: {
    providerRef: JsonValue
    secrets: string
    stage: OnchainPayoutStage
    published: boolean
  }): Promise<OnchainPayoutAdvance>
  publish(params: { providerRef: JsonValue; secrets: string }): Promise<OnchainPayoutProgress>
  status(params: {
    providerRef: JsonValue
    stage: OnchainPayoutStage
    published: boolean
  }): Promise<OnchainPayoutProgress>
}
