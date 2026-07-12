import type { StateCreator } from 'zustand'

/**
 * Debug log entry for GiftWrap events
 */
export interface GiftWrapLog {
  id: string
  timestamp: number
  relay: string
  type: 'payment_request' | 'payment_fulfillment' | 'unknown' | 'error'
  txId?: string
  amount?: number
  unit?: string
  mintUrl?: string
  status: 'received' | 'processed' | 'duplicate' | 'failed'
  error?: string
}

/**
 * Debug slice state
 */
export interface DebugSliceState {
  // Debug logs
  debugLogs: GiftWrapLog[]
  maxDebugLogs: number

  // Actions
  addDebugLog: (log: Omit<GiftWrapLog, 'id' | 'timestamp'>) => void
  clearDebugLogs: () => void
  /** Slice-local reset called by resetAll (fixes the same-name 'reset' collision where only the last spread survived) */
  resetDebug: () => void
}

/**
 * Initial debug state
 */
const initialState = {
  debugLogs: [] as GiftWrapLog[],
  maxDebugLogs: 100,
}

/**
 * Debug slice creator
 */
export const createDebugSlice: StateCreator<DebugSliceState> = (set) => ({
  ...initialState,

  addDebugLog: (log) =>
    set((state) => {
      const newLog: GiftWrapLog = {
        ...log,
        id: crypto.randomUUID(),
        timestamp: Date.now(),
      }
      const debugLogs = [newLog, ...state.debugLogs].slice(0, state.maxDebugLogs)
      return { debugLogs }
    }),

  clearDebugLogs: () => set({ debugLogs: [] }),

  resetDebug: () => set(initialState),
})
