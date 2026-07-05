/**
 * Cross-tab synchronization via BroadcastChannel.
 *
 * This is a cross-cutting browser primitive used by UI and composition.
 * It intentionally lives outside composition so UI hooks do not depend on
 * the wiring layer.
 */

const CHANNEL_NAME = 'zappi-sync'

export type SyncMessage =
  | { type: 'balance_changed' }
  | { type: 'tx_changed' }
  | { type: 'settings_changed' }
  // pending-0으로 정지한 타 탭의 stuck-sweep 타이머 재개 신호 (설계 §7.2 [F20-잔여])
  | { type: 'transfer_created' }

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

export function broadcastSync(type: SyncMessage['type']): void {
  try {
    const channel = getBroadcastChannel()
    if (channel) {
      channel.postMessage({ type } satisfies SyncMessage)
    }
  } catch {
    broadcastChannel = null
  }
}
