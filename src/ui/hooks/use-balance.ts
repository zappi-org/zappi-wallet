/**
 * useBalance — BalanceUseCase driving adapter (hook)
 *
 * ServiceContext에서 BalanceUseCase를 가져와 UI에 잔액 데이터를 제공.
 * Zustand store를 통해 캐시된 상태를 읽고, UseCase를 통해 새로고침.
 */

import { useCallback, useState } from 'react'
import { useServiceRegistry } from './use-service-registry'
import type { ModuleBalance } from '@/core/ports/driven/wallet-module.port'
import type { Amount } from '@/core/domain/amount'

export function useBalance() {
  const { balance: balanceUseCase } = useServiceRegistry()

  const [total, setTotal] = useState<Amount | null>(null)
  const [byModule, setByModule] = useState<ModuleBalance[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const [newTotal, newByModule] = await Promise.all([
        balanceUseCase.getTotal(),
        balanceUseCase.getByModule(),
      ])
      setTotal(newTotal)
      setByModule(newByModule)
    } finally {
      setIsLoading(false)
    }
  }, [balanceUseCase])

  return {
    total,
    byModule,
    isLoading,
    refresh,
  }
}
