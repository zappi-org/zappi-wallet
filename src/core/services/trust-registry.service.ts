/**
 * TrustRegistryService — TrustRegistry 포트 구현
 *
 * 현재는 `SettingsRepository.settings.mints[]` 위에 얹어 cashu mint 신뢰를 관리.
 * 포트 계약은 `accountId` 로 중립적이므로, 다른 프로토콜이 추가되면 별도 저장소
 * 로직을 확장하거나 모듈별 TrustRegistry 구현을 주입하는 방식으로 진화 가능.
 */

import type { TrustRegistry } from '@/core/ports/driving/trust-registry.usecase'
import type { SettingsRepository } from '@/core/ports/driven/settings.repository.port'

export class TrustRegistryService implements TrustRegistry {
  constructor(private readonly settingsRepo: SettingsRepository) {}

  async isTrusted(accountId: string): Promise<boolean> {
    const settings = await this.settingsRepo.getSettings()
    return settings.mints.includes(accountId)
  }

  async addTrust(accountId: string): Promise<void> {
    const settings = await this.settingsRepo.getSettings()
    if (settings.mints.includes(accountId)) return
    await this.settingsRepo.saveSettings({
      ...settings,
      mints: [...settings.mints, accountId],
    })
  }

  async revokeTrust(accountId: string): Promise<void> {
    const settings = await this.settingsRepo.getSettings()
    const filtered = settings.mints.filter((m) => m !== accountId)
    if (filtered.length === settings.mints.length) return
    await this.settingsRepo.saveSettings({
      ...settings,
      mints: filtered,
    })
  }

  async getTrustedAccounts(): Promise<string[]> {
    const settings = await this.settingsRepo.getSettings()
    return [...settings.mints]
  }
}
