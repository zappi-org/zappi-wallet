import { getDatabase } from '@/data/database'
import type { WalletSettings, EncryptedWalletData, LockState } from '@/core/types'
import type { SyncAnchor } from '@/core/types'
import { DEFAULT_MINTS, DEFAULT_RELAYS, AUTO_LOCK } from '@/core/constants'

const CURRENT_ID = 'current'

/**
 * Default wallet settings
 */
function getDefaultSettings(): WalletSettings {
  return {
    mints: [...DEFAULT_MINTS],
    relays: [...DEFAULT_RELAYS],
    autoLockEnabled: true,
    autoLockTimeoutMinutes: AUTO_LOCK.DEFAULT_TIMEOUT_MINUTES,
    soundEnabled: true,
    expertModeEnabled: false,
    manualMintSelectionEnabled: false,
  }
}

/**
 * Default lock state
 */
function getDefaultLockState(): LockState {
  return {
    isLocked: true,
    failedAttempts: 0,
  }
}

/**
 * Repository for managing settings, encrypted wallet, lock state, and sync anchor
 */
export class SettingsRepository {
  private get db() {
    return getDatabase()
  }

  // ===== Settings =====

  /**
   * Get wallet settings (returns defaults if none saved)
   * Merges saved settings with defaults to ensure all required fields are present
   */
  async getSettings(): Promise<WalletSettings> {
    const record = await this.db.settings.get(CURRENT_ID)
    if (!record) {
      return getDefaultSettings()
    }
    // Remove the 'id' field from the record
    const { id: _, ...savedSettings } = record
    // Merge with defaults to ensure all required fields exist (handles migrations)
    return {
      ...getDefaultSettings(),
      ...savedSettings,
    }
  }

  /**
   * Save wallet settings
   */
  async saveSettings(settings: WalletSettings): Promise<void> {
    await this.db.settings.put({ ...settings, id: CURRENT_ID })
  }

  // ===== Encrypted Wallet =====

  /**
   * Get encrypted wallet data
   */
  async getEncryptedWallet(): Promise<EncryptedWalletData | null> {
    const record = await this.db.encryptedWallet.get(CURRENT_ID)
    if (!record) {
      return null
    }
    const { id: _, ...data } = record
    return data
  }

  /**
   * Save encrypted wallet data
   */
  async saveEncryptedWallet(data: EncryptedWalletData): Promise<void> {
    await this.db.encryptedWallet.put({ ...data, id: CURRENT_ID })
  }

  /**
   * Delete encrypted wallet data
   */
  async deleteEncryptedWallet(): Promise<void> {
    await this.db.encryptedWallet.delete(CURRENT_ID)
  }

  // ===== Lock State =====

  /**
   * Get lock state (returns defaults if none saved)
   */
  async getLockState(): Promise<LockState> {
    const record = await this.db.lockState.get(CURRENT_ID)
    if (!record) {
      return getDefaultLockState()
    }
    const { id: _, ...state } = record
    return state
  }

  /**
   * Save lock state
   */
  async saveLockState(state: LockState): Promise<void> {
    await this.db.lockState.put({ ...state, id: CURRENT_ID })
  }

  // ===== Sync Anchor =====

  /**
   * Get sync anchor
   */
  async getSyncAnchor(): Promise<SyncAnchor | null> {
    const record = await this.db.syncAnchor.get(CURRENT_ID)
    if (!record) {
      return null
    }
    const { id: _, ...anchor } = record
    return anchor
  }

  /**
   * Save sync anchor
   */
  async saveSyncAnchor(anchor: SyncAnchor): Promise<void> {
    await this.db.syncAnchor.put({ ...anchor, id: CURRENT_ID })
  }

  // ===== Clear All =====

  /**
   * Clear all settings-related data (for logout)
   */
  async clearAll(): Promise<void> {
    await Promise.all([
      this.db.settings.clear(),
      this.db.encryptedWallet.clear(),
      this.db.lockState.clear(),
      this.db.syncAnchor.clear(),
    ])
  }
}
