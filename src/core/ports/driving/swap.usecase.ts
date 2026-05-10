import type { Amount } from '@/core/domain/amount'
import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'

export interface SwapUseCase {
  getAvailableSwaps(): SwapPair[]
  estimateSwap(params: SwapParams): Promise<Result<SwapEstimate, BaseError>>
  executeSwap(params: SwapParams): Promise<Result<SwapResult, BaseError>>
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
  /** true이면 fee를 amount에서 차감하여 전액 이체 */
  drain?: boolean
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
