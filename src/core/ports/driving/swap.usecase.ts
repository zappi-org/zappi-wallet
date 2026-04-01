import type { Amount } from '@/core/domain/amount'
import type { Result } from '@/core/domain/result'
import type { PaymentError } from '@/core/errors/payment.errors'

export interface SwapUseCase {
  getAvailableSwaps(): SwapPair[]
  estimateSwap(params: SwapParams): Promise<Result<SwapEstimate, PaymentError>>
  executeSwap(params: SwapParams): Promise<Result<SwapResult, PaymentError>>
}

export interface SwapPair {
  sourceAccountId: string
  targetAccountId: string
  moduleId: string
}

export interface SwapParams {
  sourceAccountId: string
  targetAccountId: string
  amount: Amount
}

export interface SwapEstimate {
  fee: Amount
  sourceAmount: Amount
  targetAmount: Amount
}

export interface SwapResult {
  sendTxId: string
  receiveTxId: string
  amount: Amount
  fee: Amount
}
