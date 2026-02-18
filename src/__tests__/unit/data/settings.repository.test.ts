import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SettingsRepository } from '@/data/repositories/settings.repository'
import { resetDatabase } from '@/data/database'
import type { WalletSettings, EncryptedWalletData, LockState } from '@/core/types'
import type { SyncAnchor } from '@/core/types'
import { DEFAULT_MINTS, DEFAULT_RELAYS, AUTO_LOCK } from '@/core/constants'

describe('SettingsRepository', () => {
  let repo: SettingsRepository

  beforeEach(async () => {
    await resetDatabase()
    repo = new SettingsRepository()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  describe('getSettings / saveSettings', () => {
    it('should return default settings when none saved', async () => {
      const settings = await repo.getSettings()

      expect(settings.mints).toEqual([...DEFAULT_MINTS])
      expect(settings.relays).toEqual([...DEFAULT_RELAYS])
      expect(settings.autoLockEnabled).toBe(true)
      expect(settings.autoLockTimeoutMinutes).toBe(AUTO_LOCK.DEFAULT_TIMEOUT_MINUTES)
    })

    it('should save and retrieve settings', async () => {
      const settings: WalletSettings = {
        mints: ['https://custom-mint.com'],
        relays: ['wss://custom-relay.com'],
        lightningAddress: 'user@example.com',
        autoLockEnabled: false,
        autoLockTimeoutMinutes: 10,
        soundEnabled: true,
        expertModeEnabled: true,
        manualMintSelectionEnabled: true,
      }

      await repo.saveSettings(settings)
      const saved = await repo.getSettings()

      expect(saved).toEqual(settings)
    })

    it('should update existing settings', async () => {
      const initial: WalletSettings = {
        mints: ['https://mint1.com'],
        relays: ['wss://relay1.com'],
        autoLockEnabled: true,
        autoLockTimeoutMinutes: 5,
        soundEnabled: true,
        expertModeEnabled: false,
        manualMintSelectionEnabled: false,
      }
      await repo.saveSettings(initial)

      const updated = { ...initial, lightningAddress: 'new@example.com' }
      await repo.saveSettings(updated)

      const saved = await repo.getSettings()
      expect(saved.lightningAddress).toBe('new@example.com')
    })
  })

  describe('getEncryptedWallet / saveEncryptedWallet', () => {
    it('should return null when no wallet saved', async () => {
      const wallet = await repo.getEncryptedWallet()

      expect(wallet).toBeNull()
    })

    it('should save and retrieve encrypted wallet', async () => {
      const data: EncryptedWalletData = {
        encryptedMnemonic: 'encrypted-data',
        salt: 'salt-value',
        iv: 'iv-value',
      }

      await repo.saveEncryptedWallet(data)
      const saved = await repo.getEncryptedWallet()

      expect(saved).toEqual(data)
    })

    it('should delete encrypted wallet', async () => {
      await repo.saveEncryptedWallet({
        encryptedMnemonic: 'test',
        salt: 'test',
        iv: 'test',
      })

      await repo.deleteEncryptedWallet()
      const result = await repo.getEncryptedWallet()

      expect(result).toBeNull()
    })
  })

  describe('getLockState / saveLockState', () => {
    it('should return default lock state when none saved', async () => {
      const state = await repo.getLockState()

      expect(state.isLocked).toBe(true)
      expect(state.failedAttempts).toBe(0)
    })

    it('should save and retrieve lock state', async () => {
      const state: LockState = {
        isLocked: false,
        failedAttempts: 3,
        lockedUntil: Date.now() + 60000,
      }

      await repo.saveLockState(state)
      const saved = await repo.getLockState()

      expect(saved).toEqual(state)
    })
  })

  describe('getSyncAnchor / saveSyncAnchor', () => {
    it('should return null when no anchor saved', async () => {
      const anchor = await repo.getSyncAnchor()

      expect(anchor).toBeNull()
    })

    it('should save and retrieve sync anchor', async () => {
      const anchor: SyncAnchor = {
        timestamp: Date.now(),
        lastProcessedEventId: 'event-123',
        updatedAt: Date.now(),
      }

      await repo.saveSyncAnchor(anchor)
      const saved = await repo.getSyncAnchor()

      expect(saved).toEqual(anchor)
    })
  })

  describe('clearAll', () => {
    it('should clear all settings data', async () => {
      await repo.saveSettings({
        mints: ['https://mint.com'],
        relays: ['wss://relay.com'],
        autoLockEnabled: true,
        autoLockTimeoutMinutes: 5,
        soundEnabled: true,
        expertModeEnabled: false,
        manualMintSelectionEnabled: false,
      })
      await repo.saveEncryptedWallet({
        encryptedMnemonic: 'test',
        salt: 'test',
        iv: 'test',
      })
      await repo.saveLockState({
        isLocked: false,
        failedAttempts: 0,
      })

      await repo.clearAll()

      const wallet = await repo.getEncryptedWallet()
      expect(wallet).toBeNull()
    })
  })
})
