import type { StateCreator } from 'zustand'
import type { NetworkState } from '@/core/types'

/**
 * Network slice state
 */
export interface NetworkSliceState {
  // Network status
  networkState: NetworkState
  lastOnlineAt: number | null

  // Relay connections
  connectedRelays: string[]
  isConnectingRelays: boolean

  // Actions
  setNetworkState: (state: NetworkState) => void
  setLastOnlineAt: (timestamp: number | null) => void
  setConnectedRelays: (relays: string[]) => void
  addConnectedRelay: (relay: string) => void
  removeConnectedRelay: (relay: string) => void
  setConnectingRelays: (connecting: boolean) => void
  /** 슬라이스 고유 reset — resetAll 이 호출 (동명 reset 충돌로 last-spread 만 살아남던 버그 수정, Phase 3) */
  resetNetwork: () => void
}

/**
 * Initial network state
 */
const initialState = {
  networkState: 'ONLINE' as NetworkState,
  lastOnlineAt: null as number | null,
  connectedRelays: [] as string[],
  isConnectingRelays: false,
}

/**
 * Network slice creator
 */
export const createNetworkSlice: StateCreator<NetworkSliceState> = (set) => ({
  ...initialState,

  // wasOffline 플래그 제거 (3단계 구현 리뷰 #4): 유일한 소비자(use-mint-health
  // reconnect effect)가 bootstrap 단일 리스너로 대체되어 영구 stuck-true dead
  // state가 됐었다.
  setNetworkState: (networkState) =>
    set((state) => {
      if (state.networkState === 'OFFLINE' && networkState === 'ONLINE') {
        return { networkState, lastOnlineAt: Date.now() }
      }
      return { networkState }
    }),

  setLastOnlineAt: (lastOnlineAt) => set({ lastOnlineAt }),

  setConnectedRelays: (connectedRelays) => set({ connectedRelays }),

  addConnectedRelay: (relay) =>
    set((state) => ({
      connectedRelays: state.connectedRelays.includes(relay)
        ? state.connectedRelays
        : [...state.connectedRelays, relay],
    })),

  removeConnectedRelay: (relay) =>
    set((state) => ({
      connectedRelays: state.connectedRelays.filter((r) => r !== relay),
    })),

  setConnectingRelays: (isConnectingRelays) => set({ isConnectingRelays }),

  resetNetwork: () => set(initialState),
})
