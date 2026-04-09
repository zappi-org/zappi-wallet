import { useCallback, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import {
  selectIsProcessingPayment,
  selectCurrentAmount,
  selectCanPerformOnlineOps,
} from '@/store/selectors'
import { sat, toNumber } from '@/core/domain/amount'
import { ServiceContext } from '@/ui/hooks/service-context-value'

/**
 * Hook for payment operations.
 *
 * Phase 5: ServiceRegistry 경유 (driving port만 호출).
 */
export function usePayment() {
  const { t } = useTranslation()
  const registry = useContext(ServiceContext)

  // Store state
  const isProcessingPayment = useAppStore(selectIsProcessingPayment)
  const currentAmount = useAppStore(selectCurrentAmount)
  const canPerformOnlineOps = useAppStore(selectCanPerformOnlineOps)

  // Store actions
  const setProcessingPayment = useAppStore((state) => state.setProcessingPayment)
  const setCurrentAmount = useAppStore((state) => state.setCurrentAmount)
  const addToast = useAppStore((state) => state.addToast)

  /**
   * Swap tokens between mints via SwapUseCase
   */
  const mintSwap = useCallback(
    async (fromMintUrl: string, toMintUrl: string, amount: number, options?: { drain?: boolean }) => {
      if (!canPerformOnlineOps) {
        addToast({
          type: 'error',
          message: t('toast.swapOffline'),
        })
        return null
      }

      if (!registry?.swap) {
        console.warn('[usePayment] ServiceRegistry not available — cannot perform swap')
        return null
      }

      setProcessingPayment(true)
      try {
        const result = await registry.swap.executeSwap({
          sourceAccountId: fromMintUrl,
          targetAccountId: toMintUrl,
          amount: sat(amount),
          drain: options?.drain,
        })

        if (!result.ok) {
          addToast({
            type: 'error',
            message: result.error.message,
          })
          return null
        }

        return {
          success: true,
          amount: toNumber(result.value.amount),
          fee: toNumber(result.value.fee),
          fromMintUrl,
          toMintUrl,
          transactionId: result.value.sendTxId,
        }
      } finally {
        setProcessingPayment(false)
      }
    },
    [canPerformOnlineOps, registry, setProcessingPayment, addToast, t]
  )

  return {
    // State
    isProcessingPayment,
    currentAmount,
    canPerformOnlineOps,

    // Actions
    mintSwap,
    setCurrentAmount,
  }
}
