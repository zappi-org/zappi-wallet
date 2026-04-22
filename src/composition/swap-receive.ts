import { sat, toNumber } from '@/core/domain/amount'
import type { BalanceUseCase } from '@/core/ports/driving/balance.usecase'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { SwapUseCase } from '@/core/ports/driving/swap.usecase'

const MAX_SOURCE_REMAINDER_SWAPS = 3

export interface SwapReceiveDependencies {
  payment: Pick<PaymentUseCase, 'redeem'>
  swap: Pick<SwapUseCase, 'estimateSwap' | 'executeSwap'>
  balance: Pick<BalanceUseCase, 'getByModule'>
}

export interface SwapReceiveParams {
  token: string
  sourceMintUrl: string
  targetMintUrl: string
}

export interface SwapReceiveSuccess {
  success: true
  amount: number
  sourceRemainder: number
}

export interface SwapReceiveFailure {
  success: false
  error: {
    code?: string
    message?: string
  }
}

export type SwapReceiveResult = SwapReceiveSuccess | SwapReceiveFailure

async function getAccountBalance(
  balance: Pick<BalanceUseCase, 'getByModule'>,
  accountId: string,
): Promise<number> {
  const moduleBalances = await balance.getByModule()
  for (const moduleBalance of moduleBalances) {
    const account = moduleBalance.accounts.find((candidate) => candidate.id === accountId)
    if (account) {
      return toNumber(account.amount)
    }
  }
  return 0
}

async function canDrainRemainder(
  swap: Pick<SwapUseCase, 'estimateSwap'>,
  sourceMintUrl: string,
  targetMintUrl: string,
  amount: number,
): Promise<boolean> {
  if (amount <= 0) return false

  const estimateResult = await swap.estimateSwap({
    sourceAccountId: sourceMintUrl,
    targetAccountId: targetMintUrl,
    amount: sat(amount),
  })
  if (!estimateResult.ok) return false

  return toNumber(estimateResult.value.fee) < amount
}

export async function executeSwapReceive(
  deps: SwapReceiveDependencies,
  params: SwapReceiveParams,
): Promise<SwapReceiveResult> {
  const sourceBalanceBeforeRedeem = await getAccountBalance(deps.balance, params.sourceMintUrl)

  const redeemResult = await deps.payment.redeem({ input: params.token })
  if (!redeemResult.ok) {
    return {
      success: false,
      error: { code: redeemResult.error.code, message: redeemResult.error.message },
    }
  }

  const redeemedAmount = toNumber(redeemResult.value.amount)
  if (redeemedAmount <= 0) {
    return {
      success: false,
      error: {
        code: 'FEE_TOO_HIGH',
        message: 'Redeemed amount is zero after receive fees',
      },
    }
  }

  const initialSwapIsFeasible = await canDrainRemainder(
    deps.swap,
    params.sourceMintUrl,
    params.targetMintUrl,
    redeemedAmount,
  )
  if (!initialSwapIsFeasible) {
    return {
      success: false,
      error: {
        code: 'FEE_TOO_HIGH',
        message: 'Swap fee exceeds the redeemed token amount',
      },
    }
  }

  let transferredAmount = 0
  let sourceRemainder = redeemedAmount

  for (let attempt = 0; attempt < MAX_SOURCE_REMAINDER_SWAPS && sourceRemainder > 0; attempt += 1) {
    const currentBudget = sourceRemainder
    const swapResult = await deps.swap.executeSwap({
      sourceAccountId: params.sourceMintUrl,
      targetAccountId: params.targetMintUrl,
      amount: sat(currentBudget),
      drain: true,
    })

    if (!swapResult.ok) {
      if (transferredAmount === 0) {
        return {
          success: false,
          error: { code: swapResult.error.code, message: swapResult.error.message },
        }
      }
      break
    }

    transferredAmount += toNumber(swapResult.value.amount)

    const sourceBalanceAfterSwap = await getAccountBalance(deps.balance, params.sourceMintUrl)
    sourceRemainder = Math.max(0, sourceBalanceAfterSwap - sourceBalanceBeforeRedeem)

    if (sourceRemainder <= 0 || sourceRemainder >= currentBudget) {
      break
    }

    const canContinue = await canDrainRemainder(
      deps.swap,
      params.sourceMintUrl,
      params.targetMintUrl,
      sourceRemainder,
    )
    if (!canContinue) {
      break
    }
  }

  return {
    success: true,
    amount: transferredAmount,
    sourceRemainder,
  }
}
