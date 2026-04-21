import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TrustRegistryService } from '@/core/services/trust-registry.service'
import type { SettingsRepository, WalletSettings } from '@/core/ports/driven/settings.repository.port'

function makeSettings(mints: string[]): WalletSettings {
  return {
    mints,
    relays: [],
    autoLockEnabled: true,
    autoLockTimeoutMinutes: 5,
    soundEnabled: false,
    expertModeEnabled: false,
    manualMintSelectionEnabled: false,
    balanceHidden: false,
    fiatCurrency: 'USD',
    showFiatConversion: true,
    senderPrivacyMode: false,
  }
}

function makeRepo(initial: string[]): SettingsRepository {
  let current = makeSettings(initial)
  return {
    getSettings: vi.fn().mockImplementation(async () => current),
    saveSettings: vi.fn().mockImplementation(async (next: WalletSettings) => {
      current = next
    }),
    getEncryptedWallet: vi.fn(),
    saveEncryptedWallet: vi.fn(),
    deleteEncryptedWallet: vi.fn(),
    getLockState: vi.fn(),
    saveLockState: vi.fn(),
    clearAll: vi.fn(),
  }
}

describe('TrustRegistryService', () => {
  let repo: SettingsRepository
  let service: TrustRegistryService

  beforeEach(() => {
    repo = makeRepo(['https://mint-a.test', 'https://mint-b.test'])
    service = new TrustRegistryService(repo)
  })

  describe('isTrusted', () => {
    it('returns true for existing accountId', async () => {
      await expect(service.isTrusted('https://mint-a.test')).resolves.toBe(true)
    })

    it('returns false for unknown accountId', async () => {
      await expect(service.isTrusted('https://mint-x.test')).resolves.toBe(false)
    })
  })

  describe('addTrust', () => {
    it('appends a new accountId', async () => {
      await service.addTrust('https://mint-new.test')
      await expect(service.getTrustedAccounts()).resolves.toEqual([
        'https://mint-a.test',
        'https://mint-b.test',
        'https://mint-new.test',
      ])
    })

    it('is idempotent for existing accountId', async () => {
      await service.addTrust('https://mint-a.test')
      await expect(service.getTrustedAccounts()).resolves.toEqual([
        'https://mint-a.test',
        'https://mint-b.test',
      ])
      expect(repo.saveSettings).not.toHaveBeenCalled()
    })

    it('persists via SettingsRepository', async () => {
      await service.addTrust('https://mint-new.test')
      expect(repo.saveSettings).toHaveBeenCalledTimes(1)
    })
  })

  describe('revokeTrust', () => {
    it('removes the accountId', async () => {
      await service.revokeTrust('https://mint-a.test')
      await expect(service.getTrustedAccounts()).resolves.toEqual(['https://mint-b.test'])
    })

    it('is idempotent for unknown accountId', async () => {
      await service.revokeTrust('https://mint-x.test')
      await expect(service.getTrustedAccounts()).resolves.toEqual([
        'https://mint-a.test',
        'https://mint-b.test',
      ])
      expect(repo.saveSettings).not.toHaveBeenCalled()
    })
  })

  describe('getTrustedAccounts', () => {
    it('returns a fresh copy of the trusted list', async () => {
      const a = await service.getTrustedAccounts()
      const b = await service.getTrustedAccounts()
      expect(a).toEqual(b)
      expect(a).not.toBe(b)
    })
  })
})
