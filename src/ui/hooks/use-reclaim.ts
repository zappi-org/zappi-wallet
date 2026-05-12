import { toNumber } from '@/core/domain/amount'
// import type { ReclaimedTokenResult } from '@/core/ports/driven/send-token-operator.port'
import type { ReclaimResult } from '@/core/ports/driving/reclaim.usecase'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { useWallet } from '@/ui/hooks/use-wallet'
import { broadcastSync } from '@/utils/cross-tab-sync'
import { useCallback, useContext } from 'react'

interface ReclaimHookResult extends ReclaimResult {
  amount?:{
    value:number,
    unit: string
  }
  accountId?: string
}
export function useReclaim() {
  const registry = useContext(ServiceContext)
  const { refreshBalance } = useWallet()

  const reclaim = useCallback(
    async (txId: string): Promise< ReclaimHookResult > => {
      if(!registry?.reclaim?.reclaim) {
         console.error('[useReclaim] registry:', registry)
          console.error('[useReclaim] registry?.reclaim:', registry?.reclaim)
          // use-reclaim.ts에서 registry 전체 구조 확인
        console.error('[useReclaim] registry keys:', Object.keys(registry || {}))
        console.error('[useReclaim] has reclaim:', 'reclaim' in (registry || {}))
        throw new Error('Service not available')
      }

      const tx = await registry.transactionMgmt.getById(txId)
      console.log('[useReclaim] txId:', txId, 'tx:', tx) 
      if(!tx) throw new Error('Token reclaim failed')

      //서비스 호출
      const result = await registry.reclaim.reclaim(txId)

      if(result.alreadySpent){
        return {
          success : false,
          alreadySpent : true,
          errorCode: 'ALREADY_SPENT',
          amount: {
            value: toNumber(tx.amount),
            unit: tx.amount.unit || 'sat',
          },
          accountId:tx.accountId
        }
      }
      if(!result.success){
        return {
          success:false,
          errorCode: result.errorCode,
          accountId: tx.accountId,
        }
      }
      //success
      broadcastSync('balance_changed')
      return {
        success: true,
        amount: {
           value: toNumber(tx.amount),
           unit: tx.amount.unit || 'sat',
        },
        accountId : tx.accountId,
      }
    },
    [registry, refreshBalance],
  )
  return {reclaim}
}