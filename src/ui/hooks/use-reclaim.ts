import { useCallback, useContext } from 'react'
import { toNumber } from '@/core/domain/amount'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { broadcastSync } from '@/utils/cross-tab-sync'
import { useWallet } from '@/ui/hooks/use-wallet'

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
    [registry?.payment, refreshBalance],
  )

  return { reclaim }
}