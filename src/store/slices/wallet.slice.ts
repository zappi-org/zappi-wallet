import type { StateCreator } from 'zustand'
import type { WalletBalance, MintInfo } from '@/core/types'

export interface PendingQuote {
  quoteId: string
  mintUrl: string
  amount: number
  invoice: string
  expiry: number
}

/**
 * Wallet state
 */
export interface WalletState {
  // Balance
  balance: WalletBalance
  isLoadingBalance: boolean

  // Mints
  mints: MintInfo[]
  activeMintUrl: string | null

  // Pending Lightning quotes
  pendingQuotes: PendingQuote[]

  // Actions
  setBalance: (balance: WalletBalance) => void
  setLoadingBalance: (loading: boolean) => void
  setMints: (mints: MintInfo[]) => void
  setActiveMint: (mintUrl: string | null) => void
  updateMintStatus: (mintUrl: string, isOnline: boolean) => void
  setPendingQuotes: (quotes: PendingQuote[]) => void
  addPendingQuote: (quote: PendingQuote) => void
  removePendingQuote: (quoteId: string) => void
  reset: () => void
}

/**
 * Initial wallet state
 */
const initialState = {
  balance: { total: 0, byMint: {} as Record<string, number> },
  isLoadingBalance: false,
  mints: [] as MintInfo[],
  activeMintUrl: null as string | null,
  pendingQuotes: [] as PendingQuote[],
}

/**
 * Wallet slice creator
 */
export const createWalletSlice: StateCreator<WalletState> = (set) => ({
  ...initialState,

  setBalance: (balance) => set({ balance }),

  setLoadingBalance: (isLoadingBalance) => set({ isLoadingBalance }),

  setMints: (mints) => set({ mints }),

  setActiveMint: (activeMintUrl) => set({ activeMintUrl }),

  updateMintStatus: (mintUrl, isOnline) =>
    set((state) => ({
      mints: state.mints.map((mint) =>
        mint.url === mintUrl
          ? { ...mint, isOnline, lastChecked: Date.now() }
          : mint
      ),
    })),

  setPendingQuotes: (pendingQuotes) => set({ pendingQuotes }),

  addPendingQuote: (quote) =>
    set((state) => ({
      pendingQuotes: [...state.pendingQuotes.filter((q) => q.quoteId !== quote.quoteId), quote],
    })),

  removePendingQuote: (quoteId) =>
    set((state) => ({
      pendingQuotes: state.pendingQuotes.filter((q) => q.quoteId !== quoteId),
    })),

  reset: () => set(initialState),
})
