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
  // signal to resume the stuck-sweep timer in other tabs that stopped at pending-0
  | { type: 'transfer_created' }
  // a logged-out tab wiped account data — other tabs must reload immediately and
  // restart from the cleared state (prevents them from running on stale in-memory state)
  | { type: 'logout' }

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

/**
 * Hardens other tabs right after the KDF re-encryption migration.
 *
 * This browser-primitive side effect runs only when a successful unlock returns
 * `migrated: true`:
 * 1. `settings_changed` broadcast → reloads tabs still on the old bundle so they
 *    restart on the new (v2-aware) bundle.
 * 2. Removes `localStorage['lockout']` → clears a bogus 15-minute lockout the old
 *    bundle may have left by miscounting a correct PIN as wrong. The unlock that
 *    just succeeded already proved PIN knowledge, so that lockout is meaningless.
 *
 * Why the UI/utils layer fires this rather than a core service: cross-tab-sync is
 * a browser primitive and core does not import this layer (preserves the
 * hexagonal contract).
 */
export function notifyKdfMigrated(): void {
  broadcastSync('settings_changed')
  try {
    localStorage.removeItem('lockout')
  } catch {
    // broadcast already went out even where localStorage is inaccessible (private mode, etc.) — ignore
  }
}
