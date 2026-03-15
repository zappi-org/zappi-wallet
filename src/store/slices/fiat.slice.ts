import type { StateCreator } from 'zustand'

/**
 * Fiat exchange rate slice state (runtime, not persisted to settings)
 *
 * `exchangeRate` is intentionally NOT stored — it's derived from
 * `allRates[settings.fiatCurrency]` via selectors. This avoids manual
 * synchronization when the user changes their preferred currency.
 */
export interface FiatSliceState {
  /** When the rate was last fetched (epoch ms) */
  exchangeRateFetchedAt: number | null
  /** Full rate map for all currencies (allows instant currency switching) */
  allRates: Record<string, number> | null

  // Actions
  setExchangeRates: (allRates: Record<string, number>, fetchedAt: number) => void
  resetFiat: () => void
}

const initialState = {
  exchangeRateFetchedAt: null as number | null,
  allRates: null as Record<string, number> | null,
}

export const createFiatSlice: StateCreator<FiatSliceState> = (set, get) => ({
  ...initialState,

  setExchangeRates: (allRates, fetchedAt) => {
    const prev = get()
    // Skip no-op: same timestamp means same data (each fetch produces a unique timestamp)
    if (prev.exchangeRateFetchedAt === fetchedAt) return
    set({ allRates, exchangeRateFetchedAt: fetchedAt })
  },

  resetFiat: () => set(initialState),
})
