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
  /** Slice-specific reset called by resetAll (fixes same-named reset collisions where only the last spread survived) */
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

  // Removed the wasOffline flag: its only consumer (use-mint-health's reconnect
  // effect) was replaced by a single bootstrap listener, leaving it a permanent
  // stuck-true dead state.
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
