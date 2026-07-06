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

      // Global reset (for logout) — 각 슬라이스의 고유 reset 에 위임한다.
      // 구현이 슬라이스 initialState 단일 원천을 따르므로 60줄 수동 복제의
      // 나열-드리프트(신규 필드 누락)가 원천 불가능하다 (감사 Phase 3).
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
    // enabled 게이트 필수 (감사 §6): 없으면 Redux DevTools 확장이 설치된
    // 프로덕션 브라우저로 store 내용(nostr 개인키 포함)이 스트리밍된다
    { name: 'zappi-store', enabled: import.meta.env.DEV }
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
