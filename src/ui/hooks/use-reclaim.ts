import { toNumber } from '@/core/domain/amount'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { useWallet } from '@/ui/hooks/use-wallet'
import { broadcastSync } from '@/utils/cross-tab-sync'
import { useCallback, useContext } from 'react'

export function useReclaim() {
  const registry = useContext(ServiceContext)
  const { refreshBalance } = useWallet()

  const reclaim = useCallback(
    async (txId: string): Promise<{ amount: number }> => {
      if (!registry?.payment) throw new Error('Service not available')
      const result = await registry.payment.reclaim({ transactionId: txId })
      if (!result.ok) {
        console.error('[Reclaim] Failed:', result.error)
        throw result.error
      }
      await refreshBalance()
      broadcastSync('balance_changed')
      return { amount: toNumber(result.value.amount) }
    },
    [registry, refreshBalance],
  )
  const reclaimToken = useCallback(
    async(txId: string): Promise<void> => {
      if(!registry?.transactionMgmt) throw new Error('Service not available')
      
      const tx = await registry.transactionMgmt.getById(txId)
      if(!tx) throw new Error('Token reclaim failed')

      const operationId = typeof tx.metadata?.operationId === 'string'
        ? tx.metadata.operationId : undefined
      const token = typeof tx.metadata?.token === 'string'
        ? tx.metadata.token : undefined

      const result = await registry.transactionMgmt.reclaimSendToken(txId, operationId, token)

      if (result.alreadySpent) {
        throw Object.assign(new Error('Token already spent'), { code: 'TOKEN_SPENT'})
      }
      if (!result.success){
        throw new Error('Token reclaim failed')
      }

      await refreshBalance()
      broadcastSync('balance_changed')
    },
    [registry, refreshBalance],
  )
  return { reclaim, reclaimToken}
}
