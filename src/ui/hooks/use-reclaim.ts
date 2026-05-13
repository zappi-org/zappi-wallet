import { toNumber } from '@/core/domain/amount'
import type { ReclaimSuccess } from '@/core/ports/driving/reclaim.usecase'
import type { BaseError } from '@/core/errors/base'
import { TranscationNotFoundError } from '@/core/errors/transaction'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { broadcastSync } from '@/utils/cross-tab-sync'
import { useCallback, useContext } from 'react'

export interface ReclaimHookResult {
  success: boolean
  amount?: {
    value: number
    unit: string
  }
  accountId?: string
  error?: BaseError
  alreadySpent?: boolean
}

export function useReclaim() {
  const registry = useContext(ServiceContext)

  const reclaim = useCallback(
    async (txId: string): Promise<ReclaimHookResult> => {
      if (!registry?.reclaim?.reclaim) {
        console.error('[useReclaim] Service not available')
        return {
          success: false,
          error: {
            code: 'SERVICE_NOT_READY',
            message: 'Service is not available',
          } as BaseError,
        }
      }

      // Get transaction info first for error reporting
      const tx = await registry.transactionMgmt.getById(txId)
      console.log('[useReclaim] txId:', txId, 'tx:', tx)

      if (!tx) {
        return {
          success: false,
          error: new TranscationNotFoundError(txId),
        }
      }

      // Call service
      const result = await registry.reclaim.reclaim(txId)

      if (!result.ok) {
        const error = result.error
        console.error('[useReclaim] Reclaim failed:', error)

        // Check if token was already spent
        const alreadySpent = error.code === 'TOKEN_SPENT'

        // Return error with context
        return {
          success: false,
          error,
          alreadySpent,
          amount: {
            value: toNumber(tx.amount),
            unit: tx.amount.unit || 'sat',
          },
          accountId: tx.accountId,
        }
      }

      // Success
      const successData: ReclaimSuccess = result.value
      broadcastSync('balance_changed')

      return {
        success: true,
        amount: successData.amount,
        accountId: successData.accountId,
      }
    },
    [registry]
  )

  return { reclaim }
}
