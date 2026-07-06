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
    // 중복 판정은 앱 전역 비교 canonical(:443·대소문자·슬래시 흡수)로 (감사 Phase 2 —
    // 기존 로컬 normalizeAccountId 는 또 하나의 사설 정규화 변형이었다)
    if (settings.mints.some((m) => isSameMintUrl(m, accountId))) {
      return [...settings.mints]
    }

    // 저장은 앱 전역 저장 정규화(normalizeMintUrl)로 — 기존의 trim+슬래시 제거는
    // 프로토콜 생략 입력을 그대로 저장해 다른 저장 경로와 표기가 갈라지는 내부
    // 불일치였다. 이미 프로토콜이 있는 입력에는 동작이 동일하다.
    const nextMints = [...settings.mints, normalizeMintUrl(accountId)]
    await this.settingsRepo.saveSettings({
      ...settings,
      mints: nextMints,
    })
    this.onTrustedAccountsChanged?.(nextMints)
    return nextMints
  }
}
