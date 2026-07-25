import { sat, toNumber } from '@/core/domain/amount'
import type { BalanceUseCase } from '@/core/ports/driving/balance.usecase'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { SwapUseCase } from '@/core/ports/driving/swap.usecase'
import { normalizeMintUrl } from '@/core/domain/mint-url'

const MAX_SOURCE_REMAINDER_SWAPS = 3

export interface SwapReceiveDependencies {
  payment: Pick<PaymentUseCase, 'redeem'>
  swap: Pick<SwapUseCase, 'estimateSwap' | 'executeSwap'>
  balance: Pick<BalanceUseCase, 'getByModule'>
}

export interface SwapReceiveParams {
  token: string
  amountSats: number
  sourceMintUrl: string
  targetMintUrl: string
}

interface SwapReceiveError {
  code?: string
  message?: string
}

export interface SwapReceiveSwapped {
  state: 'swapped'
  amount: number
  sourceRemainder: number
  sourceMintUrl: string
  targetMintUrl: string
}

export interface SwapReceiveRedeemedOnSource {
  state: 'redeemed-on-source'
  amount: number
  sourceMintUrl: string
  targetMintUrl: string
  error: SwapReceiveError
}

export interface SwapReceiveRedeemNotReceived {
  state: 'redeem-not-received'
  sourceMintUrl: string
  targetMintUrl: string
  error: SwapReceiveError
}

export type SwapReceiveResult =
  | SwapReceiveSwapped
  | SwapReceiveRedeemedOnSource
  | SwapReceiveRedeemNotReceived

async function getAccountBalance(
  balance: Pick<BalanceUseCase, 'getByModule'>,
  accountId: string,
): Promise<number> {
  const normalizedAccountId = normalizeMintUrl(accountId)
  const moduleBalances = await balance.getByModule()
  for (const moduleBalance of moduleBalances) {
    const account = moduleBalance.accounts.find((candidate) => normalizeMintUrl(candidate.id) === normalizedAccountId)
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
): Promise<{ ok: true; canDrain: boolean } | { ok: false; error: SwapReceiveError }> {
  if (amount <= 0) return { ok: true, canDrain: false }

  const estimateResult = await swap.estimateSwap({
    sourceAccountId: sourceMintUrl,
    targetAccountId: targetMintUrl,
    amount: sat(amount),
  })
  if (!estimateResult.ok) {
    return {
      ok: false,
      error: {
        code: 'SWAP_ESTIMATE_FAILED',
        message: estimateResult.error.message || 'Could not estimate swap fee',
      },
    }
  }

  return { ok: true, canDrain: toNumber(estimateResult.value.fee) < amount }
}

export async function executeSwapReceive(
  deps: SwapReceiveDependencies,
  params: SwapReceiveParams,
): Promise<SwapReceiveResult> {
  if (params.amountSats <= 0) {
    return {
      state: 'redeem-not-received',
      sourceMintUrl: params.sourceMintUrl,
      targetMintUrl: params.targetMintUrl,
      error: {
        code: 'REDEEM_FEE_TOO_HIGH',
        message: 'Token amount is zero',
      },
    }
  }

  const preflightSwapEstimate = await canDrainRemainder(
    deps.swap,
    params.sourceMintUrl,
    params.targetMintUrl,
    params.amountSats,
  )
  if (!preflightSwapEstimate.ok) {
    return {
      state: 'redeem-not-received',
      sourceMintUrl: params.sourceMintUrl,
      targetMintUrl: params.targetMintUrl,
      error: preflightSwapEstimate.error,
    }
  }
  if (!preflightSwapEstimate.canDrain) {
    return {
      state: 'redeem-not-received',
      sourceMintUrl: params.sourceMintUrl,
      targetMintUrl: params.targetMintUrl,
      error: {
        code: 'SWAP_FEE_TOO_HIGH',
        message: 'Swap fee exceeds the token amount',
      },
    }
  }

  const sourceBalanceBeforeRedeem = await getAccountBalance(deps.balance, params.sourceMintUrl)

  const redeemResult = await deps.payment.redeem({ input: params.token })
  if (!redeemResult.ok) {
    return {
      state: 'redeem-not-received',
      sourceMintUrl: params.sourceMintUrl,
      targetMintUrl: params.targetMintUrl,
      error: { code: redeemResult.error.code, message: redeemResult.error.message },
    }
  }

  const redeemedAmount = toNumber(redeemResult.value.amount)
  if (redeemedAmount <= 0) {
    return {
      state: 'redeem-not-received',
      sourceMintUrl: params.sourceMintUrl,
      targetMintUrl: params.targetMintUrl,
      error: {
        code: 'REDEEM_FEE_TOO_HIGH',
        message: 'Redeemed amount is zero after receive fees',
      },
    }
  }

  const initialSwapEstimate = await canDrainRemainder(
    deps.swap,
    params.sourceMintUrl,
    params.targetMintUrl,
    redeemedAmount,
  )
  if (!initialSwapEstimate.ok) {
    return {
      state: 'redeemed-on-source',
      amount: redeemedAmount,
      sourceMintUrl: params.sourceMintUrl,
      targetMintUrl: params.targetMintUrl,
      error: initialSwapEstimate.error,
    }
  }
  if (!initialSwapEstimate.canDrain) {
    return {
      state: 'redeemed-on-source',
      amount: redeemedAmount,
      sourceMintUrl: params.sourceMintUrl,
      targetMintUrl: params.targetMintUrl,
      error: {
        code: 'SWAP_FEE_TOO_HIGH',
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
          state: 'redeemed-on-source',
          amount: redeemedAmount,
          sourceMintUrl: params.sourceMintUrl,
          targetMintUrl: params.targetMintUrl,
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

    const continueEstimate = await canDrainRemainder(
      deps.swap,
      params.sourceMintUrl,
      params.targetMintUrl,
      sourceRemainder,
    )
    if (!continueEstimate.ok || !continueEstimate.canDrain) {
      break
    }
  }

  return {
    state: 'swapped',
    amount: transferredAmount,
    sourceRemainder,
    sourceMintUrl: params.sourceMintUrl,
    targetMintUrl: params.targetMintUrl,
  }
}
