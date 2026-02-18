import type { StateCreator } from 'zustand'
import type { WalletBalance, MintInfo } from '@/core/types'

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

  // Actions
  setBalance: (balance: WalletBalance) => void
  setLoadingBalance: (loading: boolean) => void
  setMints: (mints: MintInfo[]) => void
  setActiveMint: (mintUrl: string | null) => void
  updateMintStatus: (mintUrl: string, isOnline: boolean) => void
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

  reset: () => set(initialState),
})
