import { create } from 'zustand'
import { devtools, subscribeWithSelector } from 'zustand/middleware'
import { createWalletSlice, type WalletState } from './slices/wallet.slice'
import { createNetworkSlice, type NetworkSliceState } from './slices/network.slice'
import { createSyncSlice, type SyncSliceState } from './slices/sync.slice'
import { createUISlice, type UISliceState } from './slices/ui.slice'
import { createSettingsSlice, type SettingsSliceState } from './slices/settings.slice'
import { createDebugSlice, type DebugSliceState } from './slices/debug.slice'
import { createFiatSlice, type FiatSliceState } from './slices/fiat.slice'
import { createPendingTransferSlice, type PendingTransferSliceState } from './slices/pending-transfer.slice'

/**
 * Combined app store state
 */
export interface AppState
  extends WalletState,
    NetworkSliceState,
    SyncSliceState,
    UISliceState,
    SettingsSliceState,
    DebugSliceState,
    FiatSliceState,
    PendingTransferSliceState {
  resetAll: () => void
}

/**
 * Main app store
 */
export const useAppStore = create<AppState>()(
  devtools(
    subscribeWithSelector((...args) => ({
      ...createWalletSlice(...args),
      ...createNetworkSlice(...args),
      ...createSyncSlice(...args),
      ...createUISlice(...args),
      ...createSettingsSlice(...args),
      ...createDebugSlice(...args),
      ...createFiatSlice(...args),
      ...createPendingTransferSlice(...args),

      // Global reset (for logout) — delegates to each slice's own reset.
      // Since each impl follows the slice's single-source initialState, the
      // listing-drift of a 60-line manual copy (missing a new field) is impossible.
      resetAll: () => {
        const state = args[1]()
        state.resetWallet()
        state.resetNetwork()
        state.resetSync()
        state.resetUI()
        state.resetSettings()
        state.resetDebug()
        state.resetFiat()
        state.resetPendingTransfers()
      },
    })),
    // The `enabled` gate is required: without it, store contents (including the
    // nostr private key) stream to any production browser with the Redux DevTools
    // extension installed.
    { name: 'zappi-store', enabled: import.meta.env.DEV }
  )
)

export type { WalletState, PendingQuote } from './slices/wallet.slice'
export type { NetworkSliceState } from './slices/network.slice'
export type { SyncSliceState } from './slices/sync.slice'
export type { UISliceState, Toast, ModalState } from './slices/ui.slice'
export type { SettingsSliceState } from './slices/settings.slice'
export type { DebugSliceState, GiftWrapLog } from './slices/debug.slice'
export type { FiatSliceState } from './slices/fiat.slice'
export type { PendingTransferSliceState } from './slices/pending-transfer.slice'
