import type { FeeEstimator } from '@/core/ports/driven/fee-estimator.port'
import type { PaymentRoute, FeeEstimate } from '@/core/domain/routing'
import { PaymentRoute as PR } from '@/core/domain/routing'
import { InsufficientBalanceError } from '@/core/errors/payment.errors'
import { ProofValidationError } from '@cashu/coco-core'
import { withMintCycleLock } from '../internal/mint-cycle-lock'

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
    return withMintCycleLock(sourceMint, () => this.estimateMyWalletFeeCycle(sourceMint, targetMint, amount))
  }

  private async estimateMyWalletFeeCycle(
    sourceMint: string,
    targetMint: string,
    amount: number,
  ): Promise<FeeEstimate> {
    // Pre-lock snapshot — see estimateMeltFee for why
    const availableBalance = await this.getAvailableBalance(sourceMint)
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
    return { ...estimate!, availableBalance }
  }

  // availableBalance is snapshotted BEFORE prepare: the estimation lock is our
  // own transient, so the pre-lock spendable is the true spendable. A post-
  // rollback read can be poisoned by a concurrent estimate's lock window and
  // then replayed for 60s by the estimate cache.
  private async estimateMeltFee(sourceMint: string, invoice: string, amount: number): Promise<FeeEstimate> {
    return withMintCycleLock(sourceMint, async () => {
      const availableBalance = await this.getAvailableBalance(sourceMint)
      let operationId: string | null = null
      let rolledBack = false
      try {
        const meltResult = await this.backend.prepareMelt(sourceMint, invoice)
        operationId = meltResult.operationId
        await this.backend.rollbackMelt(operationId, 'fee_estimation')
        rolledBack = true
        const fee = (meltResult.fee_reserve ?? 0) + (meltResult.swap_fee ?? 0)
        return { fee, totalNeeded: amount + fee, availableBalance }
      } finally {
        // Crash-lock guard: a throw between prepare and rollback would leave
        // proofs reserved until the stale-prepared sweep. Not idempotent in
        // coco — guard on rolledBack and swallow (self-cleaned prepares throw).
        if (operationId && !rolledBack) {
          await this.backend.rollbackMelt(operationId, 'fee_estimation').catch(() => {})
        }
      }
    })
  }

  private async estimateTokenSendFee(sourceMint: string, amount: number): Promise<FeeEstimate> {
    return withMintCycleLock(sourceMint, async () => {
      const availableBalance = await this.getAvailableBalance(sourceMint)
      let operationId: string | null = null
      let rolledBack = false
      try {
        const sendResult = await this.backend.prepareSend({ mintUrl: sourceMint, amount })
        operationId = sendResult.operationId
        await this.backend.rollbackSend(operationId)
        rolledBack = true
        const fee = sendResult.fee ?? 0
        return { fee, totalNeeded: amount + fee, availableBalance }
      } finally {
        if (operationId && !rolledBack) {
          await this.backend.rollbackSend(operationId).catch(() => {})
        }
      }
    })
  }

  private async getAvailableBalance(sourceMint: string): Promise<number> {
    const balances = await this.backend.getBalances()
    const availableBalance = balances[sourceMint]
    if (!Number.isFinite(availableBalance) || availableBalance < 0) {
      throw new Error(`Balance unavailable for fee estimation on ${sourceMint}`)
    }
    return availableBalance
  }
}
