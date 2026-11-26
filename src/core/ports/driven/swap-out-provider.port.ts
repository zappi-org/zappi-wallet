import type { JsonValue } from '@/core/domain/json'
import type { SwapOutStage } from '@/core/domain/swap-out'

export interface SwapOutLimits {
  minAmount: number
  maxAmount: number
}

export interface SwapOutPaymentRequest {
  request: string
  amount: number
}

export interface SwapOutDeadline {
  blockHeight: number
  estimatedAt: number
}

export interface SwapOutOffer {
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

export interface SwapOutQuote {
  providerId: string
  offerId: string
  identifier: string
  destination: string
  sendAmount: number
  receiveAmount: number
  serviceFee: number
  networkFee: number
  sweepFee: number
  limits: SwapOutLimits
  estimatedMinutes: number
  offerRef: JsonValue
  expiresAt: number
}

export interface SwapOutStartResult {
  providerRef: JsonValue
  secrets: string
  paymentRequests: SwapOutPaymentRequest[]
  sendAmount: number
  receiveAmount: number
  deadline: SwapOutDeadline
}

export interface SwapOutProgress {
  stage: SwapOutStage
  payoutTxId?: string
  failureReason?: string
  confirmations?: number
  currentHeight?: number
}

export interface SwapOutAdvance {
  progress: SwapOutProgress
  prepared?: { secrets: string; payoutTxId: string }
}

export interface SwapOutProvider {
  readonly id: string
  listOffers(): Promise<SwapOutOffer[]>
  quote(params: {
    offerId: string
    sendAmount: number
    destination: string
  }): Promise<SwapOutQuote>
  start(params: { quote: SwapOutQuote }): Promise<SwapOutStartResult>
  resume(params: {
    providerRef: JsonValue
    secrets: string
    stage: SwapOutStage
    published: boolean
  }): Promise<SwapOutAdvance>
  publish(params: { providerRef: JsonValue; secrets: string }): Promise<SwapOutProgress>
  status(params: {
    providerRef: JsonValue
    stage: SwapOutStage
    published: boolean
  }): Promise<SwapOutProgress>
}
