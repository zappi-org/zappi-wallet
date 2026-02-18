import type { StateCreator } from 'zustand'
import type { SyncState, SyncAnchor } from '@/core/types'

/**
 * Sync slice state
 */
export interface SyncSliceState {
  // Sync status
  syncState: SyncState
  lastSyncAt: number | null
  anchor: SyncAnchor | null

  // Pending items
  pendingRetries: number
  failedSwapsCount: number

  // Progress
  syncProgress: number // 0-100
  eventsProcessed: number

  // NutZap listener state (from old stores)
  lastEventTimestamp: number
  txRefreshTrigger: number

  // NUT-18 payment received state (for EcashReceiveScreen / KioskScreen)
  lastReceivedRequestId: string | null
  lastReceivedAmount: number
  lastReceivedEventId: string | null

  // Actions
  setSyncState: (state: SyncState) => void
  setLastSyncAt: (timestamp: number | null) => void
  setAnchor: (anchor: SyncAnchor | null) => void
  setPendingRetries: (count: number) => void
  setFailedSwapsCount: (count: number) => void
  setSyncProgress: (progress: number) => void
  incrementEventsProcessed: () => void
  resetSyncProgress: () => void
  setLastEventTimestamp: (timestamp: number) => void
  triggerTxRefresh: () => void
  setLastReceivedPayment: (requestId: string | null, amount: number, eventId?: string | null) => void
  reset: () => void
}

/**
 * Initial sync state
 */
const initialState = {
  syncState: 'idle' as SyncState,
  lastSyncAt: null as number | null,
  anchor: null as SyncAnchor | null,
  pendingRetries: 0,
  failedSwapsCount: 0,
  syncProgress: 0,
  eventsProcessed: 0,
  lastEventTimestamp: 0,
  txRefreshTrigger: 0,
  lastReceivedRequestId: null as string | null,
  lastReceivedAmount: 0,
  lastReceivedEventId: null as string | null,
}

/**
 * Sync slice creator
 */
export const createSyncSlice: StateCreator<SyncSliceState> = (set) => ({
  ...initialState,

  setSyncState: (syncState) => set({ syncState }),

  setLastSyncAt: (lastSyncAt) => set({ lastSyncAt }),

  setAnchor: (anchor) => set({ anchor }),

  setPendingRetries: (pendingRetries) => set({ pendingRetries }),

  setFailedSwapsCount: (failedSwapsCount) => set({ failedSwapsCount }),

  setSyncProgress: (syncProgress) => set({ syncProgress }),

  incrementEventsProcessed: () =>
    set((state) => ({
      eventsProcessed: state.eventsProcessed + 1,
    })),

  resetSyncProgress: () =>
    set({
      syncProgress: 0,
      eventsProcessed: 0,
    }),

  setLastEventTimestamp: (lastEventTimestamp) => set({ lastEventTimestamp }),

  triggerTxRefresh: () =>
    set((state) => ({
      txRefreshTrigger: state.txRefreshTrigger + 1,
    })),

  setLastReceivedPayment: (lastReceivedRequestId, lastReceivedAmount, lastReceivedEventId = null) =>
    set({ lastReceivedRequestId, lastReceivedAmount, lastReceivedEventId }),

  reset: () => set(initialState),
})
