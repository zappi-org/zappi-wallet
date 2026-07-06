import type { StateCreator } from 'zustand'
import type { WalletBalance } from '@/core/types'
import type { PendingQuote } from '@/core/domain/quote'

export type { PendingQuote }

/**
 * Wallet state
 */
export interface WalletState {
  // Balance
  balance: WalletBalance
  isLoadingBalance: boolean

  // Pending Lightning quotes
  pendingQuotes: PendingQuote[]

  // Actions
  setBalance: (balance: WalletBalance) => void
  setLoadingBalance: (loading: boolean) => void
  setPendingQuotes: (quotes: PendingQuote[]) => void
  addPendingQuote: (quote: PendingQuote) => void
  removePendingQuote: (quoteId: string) => void
  /** 슬라이스 고유 reset — resetAll 이 호출 (동명 reset 충돌로 last-spread 만 살아남던 버그 수정, Phase 3) */
  resetWallet: () => void
}

/**
 * Initial wallet state
 */
const initialState = {
  balance: { total: 0, byMint: {} as Record<string, number> },
  isLoadingBalance: false,
  pendingQuotes: [] as PendingQuote[],
}

/**
 * Wallet slice creator
 */
export const createWalletSlice: StateCreator<WalletState> = (set) => ({
  ...initialState,

  setBalance: (balance) => set({ balance }),

  setLoadingBalance: (isLoadingBalance) => set({ isLoadingBalance }),

  setPendingQuotes: (pendingQuotes) => set({ pendingQuotes }),

  addPendingQuote: (quote) =>
    set((state) => ({
      pendingQuotes: [...state.pendingQuotes.filter((q) => q.quoteId !== quote.quoteId), quote],
    })),

  removePendingQuote: (quoteId) =>
    set((state) => ({
      pendingQuotes: state.pendingQuotes.filter((q) => q.quoteId !== quoteId),
    })),

  resetWallet: () => set(initialState),
})
