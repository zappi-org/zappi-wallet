import type { SwapOutStage } from '@/core/domain/swap-out'
import type { TransferPhase } from '@/core/domain/pending-transfer'
import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import type {
  SwapOutDeadline,
  SwapOutLimits,
  SwapOutOffer,
} from '@/core/ports/driven/swap-out-provider.port'

export type { SwapOutOffer }

export interface SwapOutQuoteView {
  quoteId: string
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
  expiresAt: number
}

export interface SwapOutView {
  id: string
  mintUrl: string
  offerId: string | null
  identifier: string | null
  destination: string
  sendAmount: number
  receiveAmount: number
  stage: SwapOutStage
  phase: TransferPhase
  payoutTxId: string | null
  failureReason: string | null
  hasOpenPayments: boolean
  deadline: SwapOutDeadline
  createdAt: number
  updatedAt: number
}

export interface SwapOutUseCase {
  isEnabled(): boolean
  listOffers(): Promise<Result<SwapOutOffer[], BaseError>>
  quote(params: {
    offerId: string
    sendAmount: number
    destination: string
    mintUrl: string
  }): Promise<Result<SwapOutQuoteView, BaseError>>
  start(params: {
    quoteId: string
    mintUrl: string
  }): Promise<Result<SwapOutView, BaseError>>
  resumeAll(): Promise<void>
  get(id: string): Promise<SwapOutView | null>
  listActive(): Promise<SwapOutView[]>
  inFlightAmount(mintUrl?: string): Promise<number>
}
