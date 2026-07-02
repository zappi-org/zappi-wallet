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
import { DEFAULT_MINTS, DEFAULT_RELAYS } from '@/core/constants'

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
  // Global reset
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

      // Global reset (for logout)
      resetAll: () => {
        const [set] = args
        set((state) => {
          // Call all individual reset functions
          state.reset() // This will be the last one, but we need all
          return {}
        })
        // Actually reset all slices
        const resetState = args[0]
        resetState({
          // Wallet
          balance: { total: 0, byMint: {} },
          isLoadingBalance: false,
          mints: [],
          activeMintUrl: null,
          pendingQuotes: [],
          // Network
          networkState: 'ONLINE',
          lastOnlineAt: null,
          connectedRelays: [],
          isConnectingRelays: false,
          // Sync
          syncState: 'idle',
          lastSyncAt: null,
          anchor: null,
          pendingRetries: 0,
          failedIncomingsCount: 0,
          pendingIncomingReviews: [],
          syncProgress: 0,
          eventsProcessed: 0,
          lastEventTimestamp: 0,
          txRefreshTrigger: 0,
          activeTransports: [],
          nostrConnectionStatus: 'disconnected',
          // UI
          isLocked: true,
          isUnlocking: false,
          toasts: [],
          modal: { isOpen: false, type: null },
          isInitializing: true,
          isProcessingPayment: false,
          currentAmount: 0,
          supportUnreadCount: 0,
          supportUnreadTicketIds: [],
          activeSupportTicketId: null,
          // Settings
          settings: {
            mints: [...DEFAULT_MINTS],
            relays: [...DEFAULT_RELAYS],
            autoLockEnabled: true,
            autoLockTimeoutMinutes: 5,
            soundEnabled: true,
            expertModeEnabled: false,
            manualMintSelectionEnabled: false,
            balanceHidden: false,
          },
          isLoadingSettings: false,
          nostrPubkey: null,
          nostrPrivkey: null,
          p2pkPubkey: null,
          // Debug
          debugLogs: [],
          maxDebugLogs: 100,
          // Fiat
          exchangeRateFetchedAt: null,
          allRates: null,
          // Pending transfers
          pendingTransfers: [],
        })
      },
    })),
    { name: 'zappi-store' }
  )
)

// Re-export slice types
export type { WalletState, PendingQuote } from './slices/wallet.slice'
export type { NetworkSliceState } from './slices/network.slice'
export type { SyncSliceState } from './slices/sync.slice'
export type { UISliceState, Toast, ModalState } from './slices/ui.slice'
export type { SettingsSliceState } from './slices/settings.slice'
export type { DebugSliceState, GiftWrapLog } from './slices/debug.slice'
export type { FiatSliceState } from './slices/fiat.slice'
export type { PendingTransferSliceState } from './slices/pending-transfer.slice'
