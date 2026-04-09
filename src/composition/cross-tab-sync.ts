/**
 * Cross-tab synchronization — BroadcastChannel infrastructure
 *
 * composition 계층에서 상태 변경 후 다른 탭에 알림.
 * React hook (useCrossTabSync)은 ui/hooks/에서 이 모듈을 소비.
 */

const CHANNEL_NAME = 'zappi-sync'

export type SyncMessage =
  | { type: 'balance_changed' }
  | { type: 'tx_changed' }
  | { type: 'settings_changed' }

// Module-level channel for broadcasting (reused across calls)
let broadcastChannel: BroadcastChannel | null = null

export function getBroadcastChannel(): BroadcastChannel | null {
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
