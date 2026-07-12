import type { FeeEstimator } from '@/core/ports/driven/fee-estimator.port'
import type { PaymentRoute, FeeEstimate } from '@/core/domain/routing'
import { PaymentRoute as PR } from '@/core/domain/routing'
import { InsufficientBalanceError } from '@/core/errors/payment.errors'
import { ProofValidationError } from '@cashu/coco-core'

export interface CashuFeeEstimatorBackend {
  prepareMelt(
    mintUrl: string,
    invoice: string,
  ): Promise<{ operationId: string; fee_reserve?: number; swap_fee?: number }>
  rollbackMelt(operationId: string, reason?: string): Promise<void>
  prepareSend(params: { mintUrl: string; amount: number }): Promise<{ operationId: string; fee?: number }>
  rollbackSend(operationId: string): Promise<void>
  createMintQuote(mintUrl: string, amount: number): Promise<{ quote: string; request: string }>
  abandonMintQuote(mintUrl: string, quoteId: string): Promise<void>
  getBalances(): Promise<Record<string, number>>
}

function rethrowClassified(error: unknown): never {
  if (error instanceof ProofValidationError && error.message.includes('Not enough proofs')) {
    throw new InsufficientBalanceError(0, 0, error)
  }
  throw error
}

export class CashuFeeEstimatorAdapter implements FeeEstimator {
  constructor(private readonly backend: CashuFeeEstimatorBackend) {}

  async estimateRouteFee(
    route: PaymentRoute,
    sourceMint: string,
    amount: number,
    targetMint?: string,
    invoice?: string,
  ): Promise<FeeEstimate> {
    try {
      switch (route) {
        case PR.MELT_TO_LN:
        case PR.LN_INTERNAL:
          if (!invoice) throw new Error('Cannot estimate Lightning fee without an invoice')
          return await this.estimateMeltFee(sourceMint, invoice, amount)

        case PR.LN_CROSS_MINT:
        case PR.MINT_AND_DM:
          if (!targetMint) throw new Error('Cannot estimate cross-mint fee without a target mint')
          return await this.estimateMyWalletFee(sourceMint, targetMint, amount)

        case PR.TOKEN_TRANSFER:
        case PR.OWN_MINT_TOKEN:
          return await this.estimateTokenSendFee(sourceMint, amount)

        default:
          throw new Error(`Cannot estimate fee for route ${route}`)
      }
    } catch (error) {
      rethrowClassified(error)
    }
  }

  async estimateMyWalletFee(
    sourceMint: string,
    targetMint: string,
    amount: number,
  ): Promise<FeeEstimate> {
    const quote = await this.backend.createMintQuote(targetMint, amount)
    let meltOperationId: string | null = null
    let estimate: Omit<FeeEstimate, 'availableBalance'> | null = null
    let operationError: unknown = null

    try {
      const meltResult = await this.backend.prepareMelt(sourceMint, quote.request)
      meltOperationId = meltResult.operationId
      const fee = (meltResult.fee_reserve ?? 0) + (meltResult.swap_fee ?? 0)
      estimate = { fee, totalNeeded: amount + fee }
    } catch (error) {
      operationError = error
    }

    let cleanupError: unknown = null
    if (meltOperationId) {
      try {
        await this.backend.rollbackMelt(meltOperationId, 'fee_estimation')
      } catch (error) {
        cleanupError = error
      }
    }
    try {
      await this.backend.abandonMintQuote(targetMint, quote.quote)
    } catch (error) {
      cleanupError ??= error
    }

    if (cleanupError) throw cleanupError
    if (operationError) throw operationError
    return { ...estimate!, availableBalance: await this.getAvailableBalance(sourceMint) }
  }

  private async estimateMeltFee(sourceMint: string, invoice: string, amount: number): Promise<FeeEstimate> {
    const meltResult = await this.backend.prepareMelt(sourceMint, invoice)
    await this.backend.rollbackMelt(meltResult.operationId, 'fee_estimation')
    const fee = (meltResult.fee_reserve ?? 0) + (meltResult.swap_fee ?? 0)
    const availableBalance = await this.getAvailableBalance(sourceMint)
    return { fee, totalNeeded: amount + fee, availableBalance }
  }

  private async estimateTokenSendFee(sourceMint: string, amount: number): Promise<FeeEstimate> {
    const sendResult = await this.backend.prepareSend({ mintUrl: sourceMint, amount })
    await this.backend.rollbackSend(sendResult.operationId)
    const fee = sendResult.fee ?? 0
    const availableBalance = await this.getAvailableBalance(sourceMint)
    return { fee, totalNeeded: amount + fee, availableBalance }
  }

  private async getAvailableBalance(sourceMint: string): Promise<number> {
    const balances = await this.backend.getBalances()
    const availableBalance = balances[sourceMint]
    if (!Number.isFinite(availableBalance) || availableBalance < 0) {
      throw new Error(`Balance unavailable after fee estimation cleanup for ${sourceMint}`)
    }
    return availableBalance
  }
}
