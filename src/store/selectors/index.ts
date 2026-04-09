import type { AppState } from '@/store'

// ===== Wallet Selectors =====

export const selectBalance = (state: AppState) => state.balance
export const selectTotalBalance = (state: AppState) => state.balance.total
export const selectBalanceByMint = (state: AppState) => state.balance.byMint
export const selectIsLoadingBalance = (state: AppState) => state.isLoadingBalance
export const selectMints = (state: AppState) => state.mints
export const selectActiveMintUrl = (state: AppState) => state.activeMintUrl
export const selectActiveMint = (state: AppState) =>
  state.mints.find((m) => m.url === state.activeMintUrl) ?? null

// ===== Network Selectors =====

export const selectNetworkState = (state: AppState) => state.networkState
export const selectIsOnline = (state: AppState) => state.networkState === 'ONLINE'
export const selectIsOffline = (state: AppState) => state.networkState === 'OFFLINE'
export const selectIsSyncing = (state: AppState) => state.networkState === 'SYNCING'
export const selectWasOffline = (state: AppState) => state.wasOffline
export const selectConnectedRelays = (state: AppState) => state.connectedRelays
export const selectConnectedRelayCount = (state: AppState) => state.connectedRelays.length

// ===== Sync Selectors =====

export const selectSyncState = (state: AppState) => state.syncState
export const selectLastSyncAt = (state: AppState) => state.lastSyncAt
export const selectAnchor = (state: AppState) => state.anchor
export const selectPendingRetries = (state: AppState) => state.pendingRetries
export const selectFailedIncomingsCount = (state: AppState) => state.failedIncomingsCount
export const selectSyncProgress = (state: AppState) => state.syncProgress
export const selectHasPendingItems = (state: AppState) =>
  state.pendingRetries > 0 || state.failedIncomingsCount > 0

// ===== UI Selectors =====

export const selectIsLocked = (state: AppState) => state.isLocked
export const selectIsUnlocking = (state: AppState) => state.isUnlocking
export const selectToasts = (state: AppState) => state.toasts
export const selectModal = (state: AppState) => state.modal
export const selectIsModalOpen = (state: AppState) => state.modal.isOpen
export const selectIsInitializing = (state: AppState) => state.isInitializing
export const selectIsProcessingPayment = (state: AppState) => state.isProcessingPayment
export const selectCurrentAmount = (state: AppState) => state.currentAmount

// ===== Settings Selectors =====

export const selectSettings = (state: AppState) => state.settings
export const selectConfiguredMints = (state: AppState) => state.settings.mints
export const selectConfiguredRelays = (state: AppState) => state.settings.relays
export const selectLightningAddress = (state: AppState) => state.settings.lightningAddress
export const selectAutoLockEnabled = (state: AppState) => state.settings.autoLockEnabled
export const selectAutoLockTimeout = (state: AppState) => state.settings.autoLockTimeoutMinutes
export const selectSoundEnabled = (state: AppState) => state.settings.soundEnabled
export const selectExpertModeEnabled = (state: AppState) => state.settings.expertModeEnabled
export const selectManualMintSelection = (state: AppState) =>
  state.settings.manualMintSelectionEnabled
export const selectNostrPubkey = (state: AppState) => state.nostrPubkey
export const selectP2pkPubkey = (state: AppState) => state.p2pkPubkey

// ===== Compound Selectors =====

/**
 * Is the app ready for use (unlocked, initialized, online)
 */
export const selectIsReady = (state: AppState) =>
  !state.isLocked && !state.isInitializing && state.networkState === 'ONLINE'

/**
 * Can perform online operations
 */
export const selectCanPerformOnlineOps = (state: AppState) =>
  state.networkState === 'ONLINE' && !state.isLocked

/**
 * Get online mints only
 */
export const selectOnlineMints = (state: AppState) =>
  state.mints.filter((m) => m.isOnline)

/**
 * Get total pending notification count (for badges)
 */
export const selectPendingCount = (state: AppState) =>
  state.pendingRetries + state.failedIncomingsCount
