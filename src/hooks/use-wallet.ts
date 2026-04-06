import { useCallback, useMemo, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import {
  selectTotalBalance,
  selectIsLoadingBalance,
  selectMints,
  selectActiveMintUrl,
} from '@/store/selectors'
import { ServiceContext } from '@/hooks/service-context-value'
import { toNumber } from '@/core/domain/amount'

/**
 * Hook for wallet state and balance operations.
 *
 * Phase 5: BalanceUseCase 경유 (ServiceContext).
 * ServiceContext 없으면 balance 갱신 불가 (store 캐시만 반환).
 */
export function useWallet() {
  const { t } = useTranslation()
  const registry = useContext(ServiceContext)

  // Store state - use primitive selectors to avoid infinite loops
  const balance = useAppStore((state) => state.balance)
  const totalBalance = useAppStore(selectTotalBalance)
  const isLoadingBalance = useAppStore(selectIsLoadingBalance)
  const mints = useAppStore(selectMints)
  const activeMintUrl = useAppStore(selectActiveMintUrl)

  // Derive onlineMints with useMemo to avoid creating new array reference on every render
  const onlineMints = useMemo(() => mints.filter((m) => m.isOnline), [mints])

  // Store actions
  const setBalance = useAppStore((state) => state.setBalance)
  const setLoadingBalance = useAppStore((state) => state.setLoadingBalance)
  const setMints = useAppStore((state) => state.setMints)
  const setActiveMint = useAppStore((state) => state.setActiveMint)
  const addToast = useAppStore((state) => state.addToast)

  /**
   * Load balance via BalanceUseCase (ServiceRegistry 경유)
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
    mints,
    activeMintUrl,
    onlineMints,

    // Actions
    loadBalance,
    refreshBalance: loadBalance, // Alias for loadBalance
    setActiveMint,
    setMints,
  }
}
