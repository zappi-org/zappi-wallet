import type { StateCreator } from 'zustand'
import type { SwapOutView } from '@/core/ports/driving/swap-out.usecase'

export interface SwapOutSliceState {
  swapOuts: SwapOutView[]
  swapOutInFlightByMint: Record<string, number>
  setSwapOuts: (payouts: SwapOutView[]) => void
  upsertSwapOut: (payout: SwapOutView) => void
  setSwapOutInFlight: (mintUrl: string, amount: number) => void
  resetSwapOuts: () => void
}

const initialState = {
  swapOuts: [] as SwapOutView[],
  swapOutInFlightByMint: {} as Record<string, number>,
}

export const createSwapOutSlice: StateCreator<SwapOutSliceState> = (set) => ({
  ...initialState,

  setSwapOuts: (swapOuts) => set({ swapOuts }),

  upsertSwapOut: (payout) =>
    set((state) => ({
      swapOuts: [
        ...state.swapOuts.filter((candidate) => candidate.id !== payout.id),
        payout,
      ],
    })),

  setSwapOutInFlight: (mintUrl, amount) =>
    set((state) => ({
      swapOutInFlightByMint: {
        ...state.swapOutInFlightByMint,
        [mintUrl]: Math.max(0, amount),
      },
    })),

  resetSwapOuts: () => set(initialState),
})
