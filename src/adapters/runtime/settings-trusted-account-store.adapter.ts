import type { SettingsRepository } from '@/core/ports/driven/settings.repository.port'
import type { TrustedAccountStore } from '@/core/ports/driven/trusted-account-store.port'
import { isSameMintUrl, normalizeMintUrl } from '@/utils/url'

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
    // Dedupe via the app-wide comparison canonical (absorbs :443, case, trailing slash);
    // the old local normalizeAccountId was yet another private normalization variant.
    if (settings.mints.some((m) => isSameMintUrl(m, accountId))) {
      return [...settings.mints]
    }

    // Store via the app-wide storage normalization (normalizeMintUrl) — the old
    // trim + slash-strip stored protocol-less input as-is, an internal inconsistency
    // that diverged from other storage paths. Behavior is identical for input that
    // already has a protocol.
    const nextMints = [...settings.mints, normalizeMintUrl(accountId)]
    await this.settingsRepo.saveSettings({
      ...settings,
      mints: nextMints,
    })
    this.onTrustedAccountsChanged?.(nextMints)
    return nextMints
  }
}
