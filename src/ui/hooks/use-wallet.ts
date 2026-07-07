import { useCallback, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import {
  selectTotalBalance,
  selectIsLoadingBalance,
} from '@/store/selectors'
import { ServiceContext } from '@/ui/hooks/service-context-value'
import { toNumber } from '@/core/domain/amount'

/**
 * Hook for wallet state and balance operations.
 *
 * Balance refresh goes through BalanceUseCase (ServiceContext). Without
 * ServiceContext, balance can't refresh (returns only the store cache).
 */
export function useWallet() {
  const { t } = useTranslation()
  const registry = useContext(ServiceContext)

  // Store state - use primitive selectors to avoid infinite loops
  const balance = useAppStore((state) => state.balance)
  const totalBalance = useAppStore(selectTotalBalance)
  const isLoadingBalance = useAppStore(selectIsLoadingBalance)
  // Store actions
  const setBalance = useAppStore((state) => state.setBalance)
  const setLoadingBalance = useAppStore((state) => state.setLoadingBalance)
  const addToast = useAppStore((state) => state.addToast)

  /**
   * Load balance via BalanceUseCase (through ServiceRegistry)
   */
  const loadBalance = useCallback(async () => {
    if (!registry?.balance) {
      console.warn('[useWallet] ServiceRegistry not available — cannot refresh balance')
      return
    }

    const hasExistingData = Object.keys(useAppStore.getState().balance.byMint).length > 0
    if (!hasExistingData) {
      setLoadingBalance(true)
    }
    try {
      const moduleBalances = await registry.balance.getByModule()
      const byMint: Record<string, number> = {}
      let total = 0
      for (const mb of moduleBalances) {
        for (const account of mb.accounts) {
          byMint[account.id] = toNumber(account.amount)
          total += toNumber(account.amount)
        }
      }
      setBalance({ total, byMint })
    } catch (error) {
      console.error('Failed to load balance:', error)
      addToast({
        type: 'error',
        message: t('toast.balanceLoadFailed'),
      })
    } finally {
      setLoadingBalance(false)
    }
  }, [registry, setBalance, setLoadingBalance, addToast, t])

  return {
    // State
    balance,
    totalBalance,
    isLoadingBalance,

    // Actions
    loadBalance,
    refreshBalance: loadBalance, // Alias for loadBalance
  }
}
