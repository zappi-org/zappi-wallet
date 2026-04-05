import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import {
  selectIsProcessingPayment,
  selectCurrentAmount,
  selectCanPerformOnlineOps,
} from '@/store/selectors'
import { PaymentService } from '@/services/payment/payment.service'
import { toErrorMessage } from '@/utils/error-message'
import { formatSats } from '@/utils/format'
import { sat, toNumber } from '@/core/domain/amount'
import { ServiceContext } from '@/hooks/service-context-value'
import { useContext } from 'react'

/**
 * Hook for payment operations
 */
export function usePayment() {
  const { t } = useTranslation()
  const paymentServiceRef = useRef<PaymentService | null>(null)

  // Get payment service singleton
  const getPaymentService = useCallback(() => {
    if (!paymentServiceRef.current) {
      paymentServiceRef.current = new PaymentService()
    }
    return paymentServiceRef.current
  }, [])

  // Store state
  const isProcessingPayment = useAppStore(selectIsProcessingPayment)
  const currentAmount = useAppStore(selectCurrentAmount)
  const canPerformOnlineOps = useAppStore(selectCanPerformOnlineOps)

  // Store actions
  const setProcessingPayment = useAppStore((state) => state.setProcessingPayment)
  const setCurrentAmount = useAppStore((state) => state.setCurrentAmount)
  const addToast = useAppStore((state) => state.addToast)

  /**
   * Create a Lightning invoice for receiving
   */
  const createInvoice = useCallback(
    async (amount: number, mintUrl?: string) => {
      if (!canPerformOnlineOps) {
        addToast({
          type: 'error',
          message: t('toast.invoiceCreateOffline'),
        })
        return null
      }

      setProcessingPayment(true)
      try {
        const paymentService = getPaymentService()
        const result = await paymentService.createLightningInvoice(amount, mintUrl)

        if (result.isErr()) {
          addToast({
            type: 'error',
            message: t('toast.invoiceCreateFailed'),
          })
          return null
        }

        return result.value
      } finally {
        setProcessingPayment(false)
      }
    },
    [canPerformOnlineOps, getPaymentService, setProcessingPayment, addToast, t]
  )

  /**
   * Claim payment after it's been paid
   */
  const claimPayment = useCallback(
    async (mintUrl: string, quoteId: string, amount: number) => {
      setProcessingPayment(true)
      try {
        const paymentService = getPaymentService()
        const result = await paymentService.claimPayment(mintUrl, quoteId, amount)

        if (result.isErr()) {
          addToast({
            type: 'error',
            message: t('toast.paymentFailed'),
          })
          return null
        }

        addToast({
          type: 'success',
          message: t('toast.tokenReceivedAmount', { amount: formatSats(result.value.amount) }),
        })

        return result.value
      } finally {
        setProcessingPayment(false)
      }
    },
    [getPaymentService, setProcessingPayment, addToast, t]
  )

  /**
   * Receive an ecash token
   */
  const receiveEcash = useCallback(
    async (token: string, options?: { privkey?: string }) => {
      setProcessingPayment(true)
      try {
        const paymentService = getPaymentService()
        const result = await paymentService.receiveEcash(token, options)

        if (result.isErr()) {
          addToast({
            type: 'error',
            message: t('toast.paymentFailed'),
          })
          return null
        }

        addToast({
          type: 'success',
          message: t('toast.tokenReceivedAmount', { amount: formatSats(result.value.amount) }),
        })

        return result.value
      } finally {
        setProcessingPayment(false)
      }
    },
    [getPaymentService, setProcessingPayment, addToast, t]
  )

  /**
   * Send Lightning payment (melt to pay invoice or Lightning address)
   */
  const sendLightning = useCallback(
    async (addressOrInvoice: string, amount: number, mintUrl?: string) => {
      if (!canPerformOnlineOps) {
        addToast({
          type: 'error',
          message: t('toast.offlineCannotPay'),
        })
        return null
      }

      setProcessingPayment(true)
      try {
        const paymentService = getPaymentService()
        const result = await paymentService.sendLightning(addressOrInvoice, amount, mintUrl)

        if (result.isErr()) {
          addToast({
            type: 'error',
            message: toErrorMessage(result.error),
          })
          return null
        }

        addToast({
          type: 'success',
          message: t('toast.sendComplete', { amount: formatSats(result.value.amount) }),
        })

        return result.value
      } finally {
        setProcessingPayment(false)
      }
    },
    [canPerformOnlineOps, getPaymentService, setProcessingPayment, addToast, t]
  )

  /**
   * Swap tokens between mints via Lightning
   * Phase 5: SwapUseCase 경유 (ServiceContext 사용 가능 시), fallback으로 old path
   */
  const registry = useContext(ServiceContext)

  const mintSwap = useCallback(
    async (fromMintUrl: string, toMintUrl: string, amount: number, options?: { drain?: boolean }) => {
      if (!canPerformOnlineOps) {
        addToast({
          type: 'error',
          message: t('toast.swapOffline'),
        })
        return null
      }

      setProcessingPayment(true)
      try {
        // New path: SwapUseCase via ServiceContext
        if (registry?.swap) {
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

          addToast({
            type: 'success',
            message: t('toast.swapComplete', { amount: formatSats(toNumber(result.value.amount)), fee: formatSats(toNumber(result.value.fee)) }),
          })

          return {
            success: true,
            amount: toNumber(result.value.amount),
            fee: toNumber(result.value.fee),
            fromMintUrl,
            toMintUrl,
            transactionId: result.value.sendTxId,
          }
        }

        // Fallback: old PaymentService (ServiceContext 없을 때)
        const paymentService = getPaymentService()
        const result = await paymentService.mintSwap(fromMintUrl, toMintUrl, amount, options)

        if (result.isErr()) {
          addToast({
            type: 'error',
            message: toErrorMessage(result.error),
          })
          return null
        }

        addToast({
          type: 'success',
          message: t('toast.swapComplete', { amount: formatSats(result.value.amount), fee: formatSats(result.value.fee) }),
        })

        return result.value
      } finally {
        setProcessingPayment(false)
      }
    },
    [canPerformOnlineOps, registry, getPaymentService, setProcessingPayment, addToast, t]
  )

  return {
    // State
    isProcessingPayment,
    currentAmount,
    canPerformOnlineOps,

    // Actions
    createInvoice,
    claimPayment,
    receiveEcash,
    sendLightning,
    mintSwap,
    setCurrentAmount,
  }
}
