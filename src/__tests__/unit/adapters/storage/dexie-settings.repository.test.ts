/**
 * DexieSettingsRepository — auto-lock timeout ceiling is enforced on LOAD, not just
 * in the settings UI. An older build could have persisted 60; the current 30-minute
 * grace ceiling must bring it down when the value is read back.
 */
import { beforeEach, describe, it, expect } from 'vitest'
import { DexieSettingsRepository } from '@/adapters/storage/dexie/dexie-settings.repository'
import { resetDatabase } from '@/adapters/storage/dexie/schema'
import { AUTO_LOCK } from '@/core/constants'

describe('DexieSettingsRepository — autoLock timeout clamp on load', () => {
  let repo: DexieSettingsRepository

  beforeEach(async () => {
    await resetDatabase()
    repo = new DexieSettingsRepository()
  })

  it('clamps a persisted timeout above the ceiling (60 → 30)', async () => {
    const base = await repo.getSettings()
    await repo.saveSettings({ ...base, autoLockTimeoutMinutes: 60 })

    const loaded = await repo.getSettings()
    expect(loaded.autoLockTimeoutMinutes).toBe(AUTO_LOCK.MAX_TIMEOUT_MINUTES)
    expect(AUTO_LOCK.MAX_TIMEOUT_MINUTES).toBe(30)
  })

  it('clamps a persisted timeout below the floor (0 → 1)', async () => {
    const base = await repo.getSettings()
    await repo.saveSettings({ ...base, autoLockTimeoutMinutes: 0 })

    const loaded = await repo.getSettings()
    expect(loaded.autoLockTimeoutMinutes).toBe(AUTO_LOCK.MIN_TIMEOUT_MINUTES)
  })

  it('leaves an in-range timeout untouched', async () => {
    const base = await repo.getSettings()
    await repo.saveSettings({ ...base, autoLockTimeoutMinutes: 10 })

    const loaded = await repo.getSettings()
    expect(loaded.autoLockTimeoutMinutes).toBe(10)
  })

  it('defaults the timeout when no record is persisted', async () => {
    const loaded = await repo.getSettings()
    expect(loaded.autoLockTimeoutMinutes).toBe(AUTO_LOCK.DEFAULT_TIMEOUT_MINUTES)
  })
})
