import type { BaseError } from '@/core/errors/base'
import { reclaimTransaction } from '@/ui/actions/reclaim-transaction'
import { ServiceContext } from '@/ui/hooks/service-context-value'
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
      return reclaimTransaction(registry, txId)
    },
    [registry]
  )

  return { reclaim }
}
