import type { StateCreator } from 'zustand'
import type { MostroSnapshot } from '@/core/domain/mostro'

/**
 * Mostro marketplace slice — reactive mirror of the adapter snapshot.
 *
 * Written only by the composition store bridge; UI reads via selectors.
 */
export interface MostroSliceState {
  mostro: MostroSnapshot

  setMostroSnapshot: (snapshot: MostroSnapshot) => void
  resetMostro: () => void
}

const initialState: { mostro: MostroSnapshot } = {
  mostro: {
    status: 'idle',
    availability: { available: false, reason: 'not_configured' },
    orders: [],
    trades: {},
  },
}

export const createMostroSlice: StateCreator<MostroSliceState> = (set) => ({
  ...initialState,

  setMostroSnapshot: (mostro) => set({ mostro }),

  resetMostro: () => set(initialState),
})
