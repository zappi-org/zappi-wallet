/**
 * DexieSettingsRepository — legacy autoLockTimeoutMinutes records migrate to the
 * autoLockEnabled boolean on load, and the stripped legacy key stays gone after a
 * save/load roundtrip.
 */
import { beforeEach, describe, it, expect } from 'vitest'
import { DexieSettingsRepository } from '@/adapters/storage/dexie/dexie-settings.repository'
import { resetDatabase, getDatabase, type SettingsRecord } from '@/adapters/storage/dexie/schema'
import type { WalletSettings } from '@/core/ports/driven/settings.repository.port'

describe('DexieSettingsRepository — autoLock setting migration', () => {
  let repo: DexieSettingsRepository

  beforeEach(async () => {
    await resetDatabase()
    repo = new DexieSettingsRepository()
  })

  it('migrates a legacy timeout record to autoLockEnabled: true and drops the old key', async () => {
    const base = await repo.getSettings()
    // Write a legacy-shaped record directly (an older build's on-disk state).
    const legacy = { ...base, autoLockTimeoutMinutes: 10 } as WalletSettings & { autoLockTimeoutMinutes: number }
    delete (legacy as Partial<WalletSettings>).autoLockEnabled
    await getDatabase().settings.put({ ...legacy, id: 'current' } as unknown as SettingsRecord)

    const loaded = await repo.getSettings()
    expect(loaded.autoLockEnabled).toBe(true)
    expect('autoLockTimeoutMinutes' in loaded).toBe(false)
  })

  it('defaults autoLockEnabled to true when no record is persisted', async () => {
    const loaded = await repo.getSettings()
    expect(loaded.autoLockEnabled).toBe(true)
  })

  it('preserves an explicit autoLockEnabled: false through save and load', async () => {
    const base = await repo.getSettings()
    await repo.saveSettings({ ...base, autoLockEnabled: false })

    const loaded = await repo.getSettings()
    expect(loaded.autoLockEnabled).toBe(false)
  })

  it('drops the legacy key from disk after a save/load roundtrip', async () => {
    const base = await repo.getSettings()
    await getDatabase().settings.put({ ...base, autoLockTimeoutMinutes: 15, id: 'current' } as unknown as SettingsRecord)

    // Load (strips) → save (persists without the key) → raw record check.
    const migrated = await repo.getSettings()
    await repo.saveSettings(migrated)
    const raw = await getDatabase().settings.get('current')
    expect(raw && 'autoLockTimeoutMinutes' in raw).toBe(false)
  })
})
