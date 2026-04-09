import type { WalletSettings, EncryptedWalletData, LockState } from '@/core/types'

export interface SettingsRepository {
  getSettings(): Promise<WalletSettings>
  saveSettings(settings: WalletSettings): Promise<void>

  getEncryptedWallet(): Promise<EncryptedWalletData | null>
  saveEncryptedWallet(data: EncryptedWalletData): Promise<void>
  deleteEncryptedWallet(): Promise<void>

  getLockState(): Promise<LockState>
  saveLockState(state: LockState): Promise<void>

  clearAll(): Promise<void>
}

// Re-export for consumers that import from port
export type { WalletSettings, EncryptedWalletData, LockState }
