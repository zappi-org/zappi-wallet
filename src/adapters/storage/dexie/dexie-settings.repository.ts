import type {
  SettingsRepository,
  WalletSettingsData,
  EncryptedWalletData,
  LockStateData,
} from '@/core/ports/driven/settings.repository.port'
import { SettingsRepository as LegacySettingsRepository } from '@/data/repositories/settings.repository'

export class DexieSettingsRepository implements SettingsRepository {
  private legacy = new LegacySettingsRepository()

  async getSettings(): Promise<WalletSettingsData> {
    return this.legacy.getSettings() as Promise<WalletSettingsData>
  }

  async saveSettings(settings: WalletSettingsData): Promise<void> {
    await this.legacy.saveSettings(settings as Parameters<typeof this.legacy.saveSettings>[0])
  }

  async getEncryptedWallet(): Promise<EncryptedWalletData | null> {
    return this.legacy.getEncryptedWallet() as Promise<EncryptedWalletData | null>
  }

  async saveEncryptedWallet(data: EncryptedWalletData): Promise<void> {
    await this.legacy.saveEncryptedWallet(data as Parameters<typeof this.legacy.saveEncryptedWallet>[0])
  }

  async deleteEncryptedWallet(): Promise<void> {
    await this.legacy.deleteEncryptedWallet()
  }

  async getLockState(): Promise<LockStateData> {
    return this.legacy.getLockState()
  }

  async saveLockState(state: LockStateData): Promise<void> {
    await this.legacy.saveLockState(state)
  }

  async clearAll(): Promise<void> {
    await this.legacy.clearAll()
  }
}
