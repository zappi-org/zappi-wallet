import type { StateCreator } from 'zustand'
import type { WalletSettings } from '@/core/types'
import { DEFAULT_MINTS, DEFAULT_RELAYS, AUTO_LOCK } from '@/core/constants'

/**
 * Settings slice state
 */
export interface SettingsSliceState {
  // Settings
  settings: WalletSettings
  isLoadingSettings: boolean

  // Derived keys (not persisted, computed from mnemonic)
  nostrPubkey: string | null
  nostrPrivkey: string | null // Memory-only, cleared on app close
  p2pkPubkey: string | null

  // Actions
  setSettings: (settings: WalletSettings) => void
  updateSettings: (partial: Partial<WalletSettings>) => void
  setLoadingSettings: (loading: boolean) => void
  setNostrPubkey: (pubkey: string | null) => void
  setNostrPrivkey: (privkey: string | null) => void
  setNostrKeyPair: (pubkey: string, privkey: string) => void
  setP2pkPubkey: (pubkey: string | null) => void
  /** 슬라이스 고유 reset — resetAll 이 호출 (동명 reset 충돌로 last-spread 만 살아남던 버그 수정, Phase 3) */
  resetSettings: () => void
}

/**
 * Default settings
 */
const defaultSettings: WalletSettings = {
  mints: [...DEFAULT_MINTS],
  relays: [...DEFAULT_RELAYS],
  autoLockEnabled: true,
  autoLockTimeoutMinutes: AUTO_LOCK.DEFAULT_TIMEOUT_MINUTES,
  soundEnabled: true,
  expertModeEnabled: false,
  manualMintSelectionEnabled: false,
  balanceHidden: false,
  fiatCurrency: 'USD',
  showFiatConversion: true,
  senderPrivacyMode: false,
  pendingEmptyDismissedAt: null,
}

/**
 * Initial settings state
 */
const initialState = {
  settings: defaultSettings,
  isLoadingSettings: false,
  nostrPubkey: null as string | null,
  nostrPrivkey: null as string | null, // Memory-only, not persisted
  p2pkPubkey: null as string | null,
}

/**
 * Settings slice creator
 */
export const createSettingsSlice: StateCreator<SettingsSliceState> = (set) => ({
  ...initialState,

  setSettings: (settings) => set({ settings }),

  updateSettings: (partial) =>
    set((state) => ({
      settings: { ...state.settings, ...partial },
    })),

  setLoadingSettings: (isLoadingSettings) => set({ isLoadingSettings }),

  setNostrPubkey: (nostrPubkey) => set({ nostrPubkey }),

  setNostrPrivkey: (nostrPrivkey) => set({ nostrPrivkey }),

  setNostrKeyPair: (nostrPubkey, nostrPrivkey) => set({ nostrPubkey, nostrPrivkey }),

  setP2pkPubkey: (p2pkPubkey) => set({ p2pkPubkey }),

  resetSettings: () => set(initialState),
})
