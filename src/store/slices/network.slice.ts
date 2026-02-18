import type { StateCreator } from 'zustand'
import type { NetworkState } from '@/core/types'

/**
 * Network slice state
 */
export interface NetworkSliceState {
  // Network status
  networkState: NetworkState
  wasOffline: boolean
  lastOnlineAt: number | null

  // Relay connections
  connectedRelays: string[]
  isConnectingRelays: boolean

  // Actions
  setNetworkState: (state: NetworkState) => void
  setWasOffline: (wasOffline: boolean) => void
  setLastOnlineAt: (timestamp: number | null) => void
  setConnectedRelays: (relays: string[]) => void
  addConnectedRelay: (relay: string) => void
  removeConnectedRelay: (relay: string) => void
  setConnectingRelays: (connecting: boolean) => void
  reset: () => void
}

/**
 * Initial network state
 */
const initialState = {
  networkState: 'ONLINE' as NetworkState,
  wasOffline: false,
  lastOnlineAt: null as number | null,
  connectedRelays: [] as string[],
  isConnectingRelays: false,
}

/**
 * Network slice creator
 */
export const createNetworkSlice: StateCreator<NetworkSliceState> = (set) => ({
  ...initialState,

  setNetworkState: (networkState) =>
    set((state) => {
      // Track if we were offline
      if (state.networkState === 'OFFLINE' && networkState === 'ONLINE') {
        return {
          networkState,
          wasOffline: true,
          lastOnlineAt: Date.now(),
        }
      }
      return { networkState }
    }),

  setWasOffline: (wasOffline) => set({ wasOffline }),

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

  reset: () => set(initialState),
})
