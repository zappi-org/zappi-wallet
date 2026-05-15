import type { StateCreator } from 'zustand'
import type { PendingTransfer } from '@/core/domain/pending-transfer'

/**
 * Pending transfer slice state
 *
 * Unified transfer lifecycle state — replaces pendingQuotes for TLS-managed flows.
 */
export interface PendingTransferSliceState {
  pendingTransfers: PendingTransfer[]

  // Actions
  setPendingTransfers: (transfers: PendingTransfer[]) => void
  addOrUpdateTransfer: (transfer: PendingTransfer) => void
  removeTransfer: (id: string) => void
  resetPendingTransfers: () => void
}

const initialState = {
  pendingTransfers: [] as PendingTransfer[],
}

export const createPendingTransferSlice: StateCreator<PendingTransferSliceState> = (set) => ({
  ...initialState,

  setPendingTransfers: (pendingTransfers) => set({ pendingTransfers }),

  addOrUpdateTransfer: (transfer) =>
    set((state) => ({
      pendingTransfers: [
        ...state.pendingTransfers.filter((t) => t.id !== transfer.id),
        transfer,
      ],
    })),

  removeTransfer: (id) =>
    set((state) => ({
      pendingTransfers: state.pendingTransfers.filter((t) => t.id !== id),
    })),

  resetPendingTransfers: () => set(initialState),
})
