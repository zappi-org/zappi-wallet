import { useCallback, useEffect, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Transaction } from '@/core/domain/transaction'
import { useAppStore } from '@/store'

/**
 * BootstrapResult.refreshBalance 표면만 — composition 타입 비의존.
 * (store 갱신을 포함하는 composition root 와이어링, unlock 후에만 존재)
 */
export interface RegistryBalanceRefresher {
  refreshBalance(): Promise<void>
}

export interface UseTransactionsDeps {
  /** unlock 후 레지스트리 (null = pre-unlock). truthy 판정을 원본과 동일하게 유지하기 위해 객체 자체를 받는다 */
  serviceRegistry: RegistryBalanceRefresher | null
  /** useWallet().refreshBalance — 레지스트리 부재 시 폴백 */
  fallbackRefreshBalance: () => Promise<void>
  /** preUnlock.txRepo — unlock 전에도 동작하는 거래 저장소 */
  txRepo: { findAll(filter?: { limit?: number }): Promise<Transaction[]> }
}

export interface TransactionsApi {
  transactions: Transaction[]
  /** pre-unlock 초기 로드(init 경로) 전용 setter */
  setTransactions: Dispatch<SetStateAction<Transaction[]>>
  /**
   * 잔액 + 거래 내역 **원자 갱신** (awaitable).
   *
   * MAJOR-14: tx만/balance만 갱신되는 창을 만들지 않기 위해 분리 금지 —
   * 모든 핸들러 훅(receive/swap 등)은 이 함수를 주입받아 공유한다.
   */
  refreshAll: () => Promise<void>
}

/**
 * 거래 내역 상태 + 원자적 잔액/거래 갱신 (MainApp Phase 4b 순수 이동).
 *
 * 소유: transactions 상태, refreshAll, txRefreshTrigger(store) 반응 효과
 * (예: GiftWrap 토큰 수신 시 재조회).
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

  // Reload transactions and balance when txRefreshTrigger changes (e.g., GiftWrap token receipt)
  // MainApp 원본 그대로 (순수 이동). set-state-in-effect 지적은 MainApp에서는 컴파일러
  // 분석 bail-out으로 미검출되던 잠복 패턴 — setTransactions는 네트워크/DB await 뒤에만
  // 호출되므로 동기 연쇄 렌더가 아니다 (4a react-hooks/refs와 동일 판정).
  useEffect(() => {
    if (txRefreshTrigger === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshAll()
  }, [txRefreshTrigger, refreshAll])

  return { transactions, setTransactions, refreshAll }
}
