import type { StateCreator } from 'zustand'
import type { OnchainPayoutView } from '@/core/ports/driving/onchain-payout.usecase'

export interface OnchainPayoutSliceState {
  onchainPayouts: OnchainPayoutView[]
  onchainPayoutInFlightByMint: Record<string, number>
  setOnchainPayouts: (payouts: OnchainPayoutView[]) => void
  upsertOnchainPayout: (payout: OnchainPayoutView) => void
  setOnchainPayoutInFlight: (mintUrl: string, amount: number) => void
  resetOnchainPayouts: () => void
}

const initialState = {
  onchainPayouts: [] as OnchainPayoutView[],
  onchainPayoutInFlightByMint: {} as Record<string, number>,
}

export const createOnchainPayoutSlice: StateCreator<OnchainPayoutSliceState> = (set) => ({
  ...initialState,

  setOnchainPayouts: (onchainPayouts) => set({ onchainPayouts }),

  upsertOnchainPayout: (payout) =>
    set((state) => ({
      onchainPayouts: [
        ...state.onchainPayouts.filter((candidate) => candidate.id !== payout.id),
        payout,
      ],
    })),

  setOnchainPayoutInFlight: (mintUrl, amount) =>
    set((state) => ({
      onchainPayoutInFlightByMint: {
        ...state.onchainPayoutInFlightByMint,
        [mintUrl]: Math.max(0, amount),
      },
    })),

  resetOnchainPayouts: () => set(initialState),
})
