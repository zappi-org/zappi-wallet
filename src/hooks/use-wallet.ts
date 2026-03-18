import { useCallback, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useAppStore } from '@/store'
import {
  selectTotalBalance,
  selectIsLoadingBalance,
  selectMints,
  selectActiveMintUrl,
} from '@/store/selectors'
import { WalletService } from '@/services/wallet/wallet.service'
import { getBalances as cocoGetBalances } from '@/coco/cashuService'
import type { Proof } from '@cashu/cashu-ts'

/**
 * Hook for wallet operations
 */
export function useWallet() {
  const { t } = useTranslation()
  const walletServiceRef = useRef<WalletService | null>(null)

  // Get wallet service singleton
  const getWalletService = useCallback(() => {
    if (!walletServiceRef.current) {
      walletServiceRef.current = new WalletService()
    }
    return walletServiceRef.current
  }, [])

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
   * Load balance from Coco (the single source of truth)
   */
  const loadBalance = useCallback(async () => {
    // Stale-while-revalidate: only show loading spinner on initial load.
    // If we already have balance data, keep showing it while refreshing.
    const hasExistingData = Object.keys(useAppStore.getState().balance.byMint).length > 0
    if (!hasExistingData) {
      setLoadingBalance(true)
    }
    try {
      // Use Coco's balance (where proofs are actually stored)
      const cocoBalances = await cocoGetBalances()

      // Convert to WalletBalance format
      const byMint: Record<string, number> = {}
      let total = 0

      for (const [mintUrl, balance] of Object.entries(cocoBalances)) {
        byMint[mintUrl] = balance
        total += balance
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
  }, [setBalance, setLoadingBalance, addToast, t])

  /**
   * Get balance for a specific mint
   */
  const getBalanceByMint = useCallback(
    async (mintUrl: string): Promise<number> => {
      const walletService = getWalletService()
      return walletService.getBalanceByMint(mintUrl)
    },
    [getWalletService]
  )

  /**
   * Add proofs to wallet
   */
  const addProofs = useCallback(
    async (mintUrl: string, proofs: Proof[]) => {
      const walletService = getWalletService()
      await walletService.addProofs(mintUrl, proofs)
      await loadBalance() // Refresh balance
    },
    [getWalletService, loadBalance]
  )

  /**
   * Get proofs for a mint
   */
  const getProofs = useCallback(
    async (mintUrl: string): Promise<Proof[]> => {
      const walletService = getWalletService()
      return walletService.getProofs(mintUrl)
    },
    [getWalletService]
  )

  /**
   * Get proofs for a specific amount
   */
  const getProofsForAmount = useCallback(
    async (mintUrl: string, amount: number) => {
      const walletService = getWalletService()
      return walletService.getProofsForAmount(mintUrl, amount)
    },
    [getWalletService]
  )

  /**
   * Remove proofs from wallet
   */
  const removeProofs = useCallback(
    async (mintUrl: string, proofs: Proof[]) => {
      const walletService = getWalletService()
      await walletService.removeProofs(mintUrl, proofs)
      await loadBalance() // Refresh balance
    },
    [getWalletService, loadBalance]
  )

  /**
   * Get configured mints
   */
  const getMints = useCallback(async (): Promise<string[]> => {
    const walletService = getWalletService()
    return walletService.getMints()
  }, [getWalletService])

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
    getBalanceByMint,
    addProofs,
    getProofs,
    getProofsForAmount,
    removeProofs,
    getMints,
    setActiveMint,
    setMints,
  }
}
