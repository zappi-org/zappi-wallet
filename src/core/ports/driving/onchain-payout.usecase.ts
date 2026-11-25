import type { OnchainPayoutStage } from '@/core/domain/onchain-payout'
import type { TransferPhase } from '@/core/domain/pending-transfer'
import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import type {
  OnchainPayoutDeadline,
  OnchainPayoutLimits,
} from '@/core/ports/driven/onchain-payout-provider.port'

export interface OnchainPayoutQuoteView {
  quoteId: string
  providerId: string
  destination: string
  sendAmount: number
  receiveAmount: number
  serviceFee: number
  networkFee: number
  sweepFee: number
  limits: OnchainPayoutLimits
  estimatedMinutes: number
  expiresAt: number
}

export interface OnchainPayoutView {
  id: string
  mintUrl: string
  destination: string
  sendAmount: number
  receiveAmount: number
  stage: OnchainPayoutStage
  phase: TransferPhase
  payoutTxId: string | null
  failureReason: string | null
  deadline: OnchainPayoutDeadline
  createdAt: number
  updatedAt: number
}

export interface OnchainPayoutUseCase {
  isEnabled(): boolean
  quote(params: {
    sendAmount: number
    destination: string
    mintUrl: string
  }): Promise<Result<OnchainPayoutQuoteView, BaseError>>
  start(params: {
    quoteId: string
    mintUrl: string
  }): Promise<Result<OnchainPayoutView, BaseError>>
  resumeAll(): Promise<void>
  get(id: string): Promise<OnchainPayoutView | null>
  listActive(): Promise<OnchainPayoutView[]>
  inFlightAmount(mintUrl?: string): Promise<number>
}
