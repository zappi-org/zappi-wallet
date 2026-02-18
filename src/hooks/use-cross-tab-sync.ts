import { useEffect } from 'react'
import { useAppStore } from '@/store'

const CHANNEL_NAME = 'zappi-sync'

type SyncMessage =
  | { type: 'balance_changed' }
  | { type: 'tx_changed' }
  | { type: 'settings_changed' }

// Module-level channel for broadcasting (reused across calls)
let broadcastChannel: BroadcastChannel | null = null

function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  if (!broadcastChannel) {
    try {
      broadcastChannel = new BroadcastChannel(CHANNEL_NAME)
    } catch {
      return null
    }
  }
  return broadcastChannel
}

/**
 * Cross-tab synchronization hook using BroadcastChannel API.
 * When one tab makes a state-changing operation (payment, mint change, etc.),
 * it broadcasts a sync signal. Other tabs receive the signal and refresh
 * their balance/transactions from IndexedDB.
 */
export function useCrossTabSync() {
  const triggerTxRefresh = useAppStore((s) => s.triggerTxRefresh)

  useEffect(() => {
    // Use the shared channel instance so we don't receive our own messages.
    // BroadcastChannel only delivers messages to OTHER instances with the same name.
    const channel = getBroadcastChannel()
    if (!channel) return

    const handler = (event: MessageEvent<SyncMessage>) => {
      const msg = event.data
      if (msg.type === 'balance_changed' || msg.type === 'tx_changed') {
        // Trigger transaction + balance refresh from IndexedDB
        triggerTxRefresh()
      } else if (msg.type === 'settings_changed') {
        // Settings changed in another tab (mints, relays, etc.)
        // Reload to pick up new settings from IndexedDB
        window.location.reload()
      }
    }

    channel.addEventListener('message', handler)

    return () => {
      channel.removeEventListener('message', handler)
      // Don't close — channel is shared module-level singleton
    }
  }, [triggerTxRefresh])
}

/**
 * Broadcast a sync signal to other tabs.
 * Call this after state-changing operations.
 */
export function broadcastSync(type: SyncMessage['type']) {
  try {
    const channel = getBroadcastChannel()
    if (channel) {
      channel.postMessage({ type } satisfies SyncMessage)
    }
  } catch {
    // BroadcastChannel may fail in some contexts (e.g., iframes)
    // Reset channel so next call retries
    broadcastChannel = null
  }
}
