import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Transaction } from '@/core/domain/transaction'
import { useAppStore } from '@/store'

/**
 * Just the refreshBalance surface of BootstrapResult — decoupled from the composition type.
 * (Composition-root wiring that updates the store; exists only after unlock.)
 */
export interface RegistryBalanceRefresher {
  refreshBalance(): Promise<void>
}

export interface UseTransactionsDeps {
  /** Post-unlock registry (null = pre-unlock). Takes the object itself to keep the truthy check identical to the original. */
  serviceRegistry: RegistryBalanceRefresher | null
  /** useWallet().refreshBalance — fallback when the registry is absent. */
  fallbackRefreshBalance: () => Promise<void>
  /** preUnlock.txRepo — transaction store that works even before unlock. */
  txRepo: { findAll(filter?: { limit?: number }): Promise<Transaction[]> }
}

export interface TransactionsApi {
  transactions: Transaction[]
  /** Setter for the pre-unlock initial load (init path) only. */
  setTransactions: Dispatch<SetStateAction<Transaction[]>>
  /**
   * Atomic (awaitable) refresh of balance + transaction history.
   *
   * Must not be split apart — otherwise a window opens where only tx or only balance is
   * updated. All handler hooks (receive/swap/etc.) share this one injected function.
   */
  refreshAll: () => Promise<void>
}

/**
 * Transaction-history state + atomic balance/transaction refresh.
 *
 * Owns: transactions state, refreshAll, and the effect reacting to txRefreshTrigger (store)
 * — e.g., re-fetching when a GiftWrap token is received.
 */
export function useTransactions(deps: UseTransactionsDeps): TransactionsApi {
  const { serviceRegistry, fallbackRefreshBalance, txRepo } = deps

  const [transactions, setTransactions] = useState<Transaction[]>([])
  const txRefreshTrigger = useAppStore((state) => state.txRefreshTrigger)

  /** Refresh balance + transaction history in parallel */
  const refreshAll = useCallback(async () => {
    const balancePromise = serviceRegistry
      ? serviceRegistry.refreshBalance()
      : fallbackRefreshBalance()
    const [, txHistory] = await Promise.all([
      balancePromise,
      txRepo.findAll({ limit: 100 }),
    ])
    setTransactions(txHistory)
  }, [serviceRegistry, fallbackRefreshBalance, txRepo])

  // Reload transactions and balance when txRefreshTrigger changes (e.g., GiftWrap token receipt).
  // The set-state-in-effect lint is safe here: setTransactions runs only after a network/DB
  // await, so it never triggers a synchronous cascading render.
  useEffect(() => {
    if (txRefreshTrigger === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshAll()
  }, [txRefreshTrigger, refreshAll])

  return { transactions, setTransactions, refreshAll }
}
