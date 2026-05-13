import type { SettingsRepository } from '@/core/ports/driven/settings.repository.port'
import type { TrustedAccountStore } from '@/core/ports/driven/trusted-account-store.port'

export class SettingsTrustedAccountStoreAdapter implements TrustedAccountStore {
  constructor(
    private readonly settingsRepo: SettingsRepository,
    private readonly onTrustedAccountsChanged?: (accounts: string[]) => void,
  ) {}

  async getTrustedAccounts(): Promise<string[]> {
    const settings = await this.settingsRepo.getSettings()
    return [...settings.mints]
  }

  async addTrustedAccount(accountId: string): Promise<string[]> {
    const settings = await this.settingsRepo.getSettings()
    const normalizedExisting = new Set(settings.mints.map(normalizeAccountId))
    if (normalizedExisting.has(normalizeAccountId(accountId))) {
      return [...settings.mints]
    }

    const nextMints = [...settings.mints, accountId.trim().replace(/\/+$/, '')]
    await this.settingsRepo.saveSettings({
      ...settings,
      mints: nextMints,
    })
    this.onTrustedAccountsChanged?.(nextMints)
    return nextMints
  }
}

function normalizeAccountId(accountId: string): string {
  return accountId.trim().replace(/\/+$/, '').toLowerCase()
}
