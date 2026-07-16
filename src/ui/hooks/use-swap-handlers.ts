import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { sat, toNumber } from '@/core/domain/amount'
import type { BaseError } from '@/core/errors/base'
import { ServiceNotReadyError } from '@/core/errors/base'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { useAppStore } from '@/store'
import { translateError } from '@/ui/utils/error-i18n'

export interface UseSwapHandlersDeps {
  serviceRegistry: ServiceRegistry | null
  /** useTransactions().refreshAll — atomic balance+transaction refresh (shared contract; do not split) */
  refreshAll: () => Promise<void>
}

export interface SwapHandlers {
  handleEstimateSwapFee: (
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
  ) => Promise<{ fee: number; totalNeeded: number } | null>
  handleEstimateRedeemFee: (
    token: string,
  ) => Promise<{ grossAmount: number; fee: number; netAmount: number } | null>
  handleSwapReceive: (
    token: string,
    sourceMintUrl: string,
    targetMintUrl: string,
    amount: number,
  ) => Promise<{ success: boolean; amount?: number; error?: BaseError }>
  handleMintSwap: (
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
  ) => Promise<{ success: boolean; amount?: number; fee?: number; transactionId?: string } | null>
}

/**
 * Cross-mint swap handlers: swap fee estimate, redeem fee estimate, redeem+swap
 * receive, and mint-to-mint swap execution.
 *
 * handleEstimateRedeemFee lives here because it estimates the untrusted-mint
 * receive path (redeem→swap) that TokenRegisterFlow consumes alongside onSwapReceive.
 */
export function useSwapHandlers(deps: UseSwapHandlersDeps): SwapHandlers {
  const { serviceRegistry, refreshAll } = deps
  const { t } = useTranslation()
  const addToast = useAppStore((state) => state.addToast)

  /** Estimate Lightning fee for cross-mint swap (non-destructive) */
  const handleEstimateSwapFee = useCallback(async (
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
  ): Promise<{ fee: number; totalNeeded: number } | null> => {
    if (!serviceRegistry?.swap) {
      console.warn('[useSwapHandlers] ServiceRegistry not ready — cannot estimate swap fee')
      return null
    }

    const result = await serviceRegistry.swap.estimateSwap({
      sourceAccountId: fromMintUrl,
      targetAccountId: toMintUrl,
      amount: sat(amount),
    })
    if (result.ok) {
      const fee = toNumber(result.value.fee)
      return { fee, totalNeeded: amount + fee }
    }
    return null
  }, [serviceRegistry])

  const handleEstimateRedeemFee = useCallback(async (
    token: string,
  ): Promise<{ grossAmount: number; fee: number; netAmount: number } | null> => {
    if (!serviceRegistry?.payment) return null
    const result = await serviceRegistry.payment.estimateRedeemFee({ input: token })
    if (result.ok) {
      return {
        grossAmount: toNumber(result.value.grossAmount),
        fee: toNumber(result.value.fee),
        netAmount: toNumber(result.value.netAmount),
      }
    }
    return null
  }, [serviceRegistry])

  const handleSwapReceive = useCallback(async (
    token: string,
    sourceMintUrl: string,
    targetMintUrl: string,
    amount: number,
  ): Promise<{ success: boolean; amount?: number; error?: BaseError }> => {
    if (!serviceRegistry?.payment || !serviceRegistry?.swap) {
      return { success: false, error: new ServiceNotReadyError('payment/swap') }
    }

    const redeemResult = await serviceRegistry.payment.redeem({ input: token })
    if (!redeemResult.ok) {
      return { success: false, error: redeemResult.error }
    }

    const swapResult = await serviceRegistry.swap.executeSwap({
      sourceAccountId: sourceMintUrl,
      targetAccountId: targetMintUrl,
      amount: sat(amount),
    })
    if (!swapResult.ok) {
      refreshAll().catch((e) => console.error('[useSwapHandlers] refreshAll after swap fail:', e))
      return { success: false, error: swapResult.error }
    }

    refreshAll().catch((e) => console.error('[useSwapHandlers] refreshAll after swap:', e))
    return { success: true, amount: toNumber(swapResult.value.amount) }
  }, [serviceRegistry, refreshAll])

  /** Cross-mint swap: execute swap from source mint to target mint */
  const handleMintSwap = useCallback(async (
    fromMintUrl: string,
    toMintUrl: string,
    amount: number,
  ): Promise<{ success: boolean; amount?: number; fee?: number; transactionId?: string } | null> => {
    if (!serviceRegistry?.swap) {
      console.warn('[useSwapHandlers] ServiceRegistry not ready — cannot perform swap')
      return null
    }

    const result = await serviceRegistry.swap.executeSwap({
      sourceAccountId: fromMintUrl,
      targetAccountId: toMintUrl,
      amount: sat(amount),
    })

    if (!result.ok) {
      addToast({ type: 'error', message: translateError(result.error, t), duration: 4000 })
      return null
    }

    refreshAll().catch((e) => console.error('[useSwapHandlers] refreshAll after swap:', e))
    return {
      success: true,
      amount: toNumber(result.value.amount),
      fee: toNumber(result.value.fee),
      transactionId: result.value.sendTxId,
    }
  }, [serviceRegistry, refreshAll, addToast, t])

  return {
    handleEstimateSwapFee,
    handleEstimateRedeemFee,
    handleSwapReceive,
    handleMintSwap,
  }
}
