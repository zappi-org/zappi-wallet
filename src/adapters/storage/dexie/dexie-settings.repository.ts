import type {
  SettingsRepository,
  WalletSettings,
  EncryptedWalletData,
  LockState,
} from '@/core/ports/driven/settings.repository.port'
import { getDatabase, type SettingsRecord, type EncryptedWalletRecord, type LockStateRecord } from './schema'
import { DEFAULT_MINTS, DEFAULT_RELAYS, AUTO_LOCK } from '@/core/constants'

const CURRENT_ID = 'current'

function getDefaultSettings(): WalletSettings {
  return {
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
    pendingEmptyDismissedAt: null,
  } as WalletSettings
}

function getDefaultLockState(): LockState {
  return { isLocked: true, failedAttempts: 0 }
}

/**
 * Standalone Dexie settings repository — no legacy repo dependency.
 * Directly accesses Dexie tables via getDatabase().
 */
export class DexieSettingsRepository implements SettingsRepository {
  private get db() { return getDatabase() }

  async getSettings(): Promise<WalletSettings> {
    const record = await this.db.settings.get(CURRENT_ID)
    if (!record) return getDefaultSettings()
    const { id: _, ...saved } = record
    return { ...getDefaultSettings(), ...saved } as WalletSettings
  }

  async saveSettings(settings: WalletSettings): Promise<void> {
    await this.db.settings.put({ ...settings, id: CURRENT_ID } as SettingsRecord)
  }

  async getEncryptedWallet(): Promise<EncryptedWalletData | null> {
    const record = await this.db.encryptedWallet.get(CURRENT_ID)
    if (!record) return null
    const { id: _, ...data } = record
    return data as EncryptedWalletData
  }

  async saveEncryptedWallet(data: EncryptedWalletData): Promise<void> {
    await this.db.encryptedWallet.put({ ...data, id: CURRENT_ID } as EncryptedWalletRecord)
  }

  async deleteEncryptedWallet(): Promise<void> {
    await this.db.encryptedWallet.delete(CURRENT_ID)
  }

  async getLockState(): Promise<LockState> {
    const record = await this.db.lockState.get(CURRENT_ID)
    if (!record) return getDefaultLockState()
    const { id: _, ...state } = record
    return state as LockState
  }

  async saveLockState(state: LockState): Promise<void> {
    await this.db.lockState.put({ ...state, id: CURRENT_ID } as LockStateRecord)
  }

  async clearAll(): Promise<void> {
    await Promise.all([
      this.db.settings.clear(),
      this.db.encryptedWallet.clear(),
      this.db.lockState.clear(),
      this.db.syncAnchor.clear(),
    ])
  }
}
