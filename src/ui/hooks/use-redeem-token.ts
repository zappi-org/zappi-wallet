import { toNumber } from '@/core/domain/amount'
import type { BaseError } from '@/core/errors/base'
import { ServiceNotReadyError } from '@/core/errors/base'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { useCallback } from 'react'

interface RedeemTokenResult {
  success: boolean
  amount?: number
  transactionId?: string
  error?: BaseError
}

export function useRedeemToken(
  serviceRegistry: ServiceRegistry | null,
  onSuccess?: () => void,
) {
  return useCallback(async (
    token: string,
    metadata?: Record<string, unknown>,
  ): Promise<RedeemTokenResult> => {
    if (!serviceRegistry?.payment) {
      return { success: false, error: new ServiceNotReadyError('payment') }
    }

    const result = await serviceRegistry.payment.redeem({ input: token, metadata })
    if (result.ok) {
      onSuccess?.()
      return { success: true, amount: toNumber(result.value.amount), transactionId: result.value.requestId }
    }

    return { success: false, error: result.error }
  }, [serviceRegistry, onSuccess])
}
