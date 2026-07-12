/**
 * wipeAccountData — the logout full-wipe contract.
 *
 * Pinned:
 * - Ordering contract: cross-tab stop signal (⓪) → stop writers (①) → coco DB (②)
 *   → zappi DB clear-first (③) → mnemonic is the last destructive step (④) →
 *   localStorage (⑤) → re-broadcast (⑥) → store reset (⑦)
 * - Mnemonic-last invariant: if ②③ fail, the wallet record must survive so
 *   verifyPassword retry stays possible. The reverse order leaves a half state:
 *   mnemonic gone + plaintext proofs left + retry impossible + onboarding inherited.
 * - Data wipe proceeds fully even with no registry (before bootstrap).
 * - Failure in a data-wipe step (②③㉠④) surfaces via throw (no faking success).
 * - db.delete() is best-effort: even if it blocks/fails the data is already
 *   cleared at ㉠, so proceed.
 * - localStorage: delete account data only; keep device defenses/preferences
 *   (lockout·invite·language·ks).
 *
 * DB·coco·broadcast are mocked at the boundary; the localStorage adapter and
 * store are real.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { wipeAccountData, type WipeAccountDeps } from '@/composition/logout'
import { useAppStore } from '@/store'

const { deleteCocoDataMock, broadcastSyncMock, dbHolder } = vi.hoisted(() => ({
  deleteCocoDataMock: vi.fn(),
  broadcastSyncMock: vi.fn(),
  dbHolder: {
    db: null as unknown as { tables: Array<{ clear: () => Promise<void> }>; delete: () => Promise<void> },
  },
}))

vi.mock('@/modules/cashu', () => ({ deleteCocoData: deleteCocoDataMock }))
vi.mock('@/utils/cross-tab-sync', () => ({ broadcastSync: broadcastSyncMock }))
vi.mock('@/adapters/storage/dexie/schema', () => ({ getDatabase: () => dbHolder.db }))

function makeDb(over?: { failClear?: boolean; deleteImpl?: () => Promise<void> }) {
  const tables = [
    { clear: vi.fn().mockResolvedValue(undefined) },
    {
      clear: over?.failClear
        ? vi.fn().mockRejectedValue(new Error('clear failed'))
        : vi.fn().mockResolvedValue(undefined),
    },
  ]
  const db = { tables, delete: vi.fn(over?.deleteImpl ?? (() => Promise.resolve())) }
  dbHolder.db = db
  return db
}

function makeDeps() {
  return {
    security: { deleteWallet: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
    registry: {
      support: { destroy: vi.fn<() => Promise<void>>().mockResolvedValue(undefined) },
      dispose: vi.fn<() => void>(),
    },
    removePasskey: vi.fn<() => void>(),
  } satisfies WipeAccountDeps
}

function orderOf(fn: { mock: { invocationCallOrder: number[] } }, nth = 0): number {
  return fn.mock.invocationCallOrder[nth]
}

describe('wipeAccountData', () => {
  beforeEach(() => {
    deleteCocoDataMock.mockReset().mockResolvedValue(undefined)
    broadcastSyncMock.mockReset()
    localStorage.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('ordering contract: early broadcast → stop → coco → zappi clear → delete → mnemonic → localStorage → re-broadcast → reset', async () => {
    const db = makeDb()
    const deps = makeDeps()
    const resetAllSpy = vi.spyOn(useAppStore.getState(), 'resetAll')

    try {
      await wipeAccountData(deps)

      // ⓪ Early broadcast precedes every step — blocks the cross-tab revive-write window
      expect(orderOf(broadcastSyncMock, 0)).toBeLessThan(orderOf(deps.registry.support.destroy))
      expect(orderOf(deps.registry.support.destroy)).toBeLessThan(orderOf(deps.registry.dispose))
      expect(orderOf(deps.registry.dispose)).toBeLessThan(orderOf(deleteCocoDataMock))
      expect(orderOf(deleteCocoDataMock)).toBeLessThan(orderOf(db.tables[0].clear))
      expect(orderOf(db.tables[0].clear)).toBeLessThan(orderOf(db.delete))
      // Mnemonic-last invariant: the wallet record is deleted after all data is wiped
      expect(orderOf(db.delete)).toBeLessThan(orderOf(deps.security.deleteWallet))
      expect(orderOf(deps.security.deleteWallet)).toBeLessThan(orderOf(deps.removePasskey))
      expect(orderOf(deps.removePasskey)).toBeLessThan(orderOf(broadcastSyncMock, 1))
      expect(orderOf(broadcastSyncMock, 1)).toBeLessThan(orderOf(resetAllSpy))

      expect(broadcastSyncMock).toHaveBeenCalledTimes(2)
      expect(broadcastSyncMock).toHaveBeenNthCalledWith(1, 'logout')
      expect(broadcastSyncMock).toHaveBeenNthCalledWith(2, 'logout')
    } finally {
      resetAllSpy.mockRestore()
    }
  })

  it('wipes everything including coco DB even without a registry (before bootstrap)', async () => {
    const db = makeDb()
    const deps = { ...makeDeps(), registry: null }

    await wipeAccountData(deps)

    expect(deleteCocoDataMock).toHaveBeenCalled()
    for (const table of db.tables) expect(table.clear).toHaveBeenCalled()
    expect(deps.security.deleteWallet).toHaveBeenCalled()
    expect(deps.removePasskey).toHaveBeenCalled()
    expect(broadcastSyncMock).toHaveBeenCalledTimes(2)
  })

  it('coco DB delete failure → throw, mnemonic survives (preserves retryable state)', async () => {
    const db = makeDb()
    const deps = makeDeps()
    deleteCocoDataMock.mockRejectedValue(new Error('Coco DB delete timed out'))

    await expect(wipeAccountData(deps)).rejects.toThrow('Coco DB delete timed out')
    expect(db.tables[0].clear).not.toHaveBeenCalled()
    // Key: the wallet record must survive for verifyPassword → retry to hold
    expect(deps.security.deleteWallet).not.toHaveBeenCalled()
    // Only the early broadcast (⓪) fired; no completion signal (⑥)
    expect(broadcastSyncMock).toHaveBeenCalledTimes(1)
  })

  it('zappi table clear failure → throw, mnemonic survives', async () => {
    makeDb({ failClear: true })
    const deps = makeDeps()

    await expect(wipeAccountData(deps)).rejects.toThrow('clear failed')
    expect(deps.security.deleteWallet).not.toHaveBeenCalled()
    expect(broadcastSyncMock).toHaveBeenCalledTimes(1)
  })

  it('mnemonic delete (④) failure → throw, later steps skipped — but data is already wiped', async () => {
    const db = makeDb()
    const deps = makeDeps()
    deps.security.deleteWallet.mockRejectedValue(new Error('secure storage down'))

    await expect(wipeAccountData(deps)).rejects.toThrow('secure storage down')
    // Data wipe completed before reaching here — a retry converges via idempotent re-run
    expect(deleteCocoDataMock).toHaveBeenCalled()
    expect(db.tables[0].clear).toHaveBeenCalled()
    expect(deps.removePasskey).not.toHaveBeenCalled()
    expect(broadcastSyncMock).toHaveBeenCalledTimes(1) // no completion signal (⑥)
  })

  it('db.delete() blocks forever → warns after timeout and continues (data was wiped at ㉠)', async () => {
    vi.useFakeTimers()
    makeDb({ deleteImpl: () => new Promise<void>(() => {}) })
    const deps = makeDeps()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      const wipe = wipeAccountData(deps)
      await vi.advanceTimersByTimeAsync(5_000)
      await wipe

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('zappi DB delete blocked/failed after clear'),
        expect.any(Error),
      )
      expect(deps.security.deleteWallet).toHaveBeenCalled()
      expect(deps.removePasskey).toHaveBeenCalled()
      expect(broadcastSyncMock).toHaveBeenCalledTimes(2)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('immediate db.delete() failure also warns then continues', async () => {
    makeDb({ deleteImpl: () => Promise.reject(new Error('delete refused')) })
    const deps = makeDeps()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await wipeAccountData(deps)
      expect(deps.security.deleteWallet).toHaveBeenCalled()
      expect(broadcastSyncMock).toHaveBeenCalledTimes(2)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('support.destroy failure does not abort the wipe (aborting = more data left behind)', async () => {
    makeDb()
    const deps = makeDeps()
    deps.registry.support.destroy.mockRejectedValue(new Error('support down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    try {
      await wipeAccountData(deps)
      expect(deps.registry.dispose).toHaveBeenCalled()
      expect(deleteCocoDataMock).toHaveBeenCalled()
      expect(deps.security.deleteWallet).toHaveBeenCalled()
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('localStorage policy: delete account data, keep device defenses/preferences', async () => {
    makeDb()
    // To be deleted
    localStorage.setItem('zappi-anchor', '{"eventId":"old"}')
    localStorage.setItem('zappi-balance-cache', '{"total":999}')
    localStorage.setItem('zappi_last_alive_at', String(Date.now()))
    // To be kept
    localStorage.setItem('zappi-language', 'ko')
    localStorage.setItem('zappi.ks.cursor', '1')
    localStorage.setItem('zappi_invite_attempts', '3')

    await wipeAccountData(makeDeps())

    expect(localStorage.getItem('zappi-anchor')).toBeNull()
    expect(localStorage.getItem('zappi-balance-cache')).toBeNull()
    expect(localStorage.getItem('zappi_last_alive_at')).toBeNull()
    expect(localStorage.getItem('zappi-language')).toBe('ko')
    expect(localStorage.getItem('zappi.ks.cursor')).toBe('1')
    expect(localStorage.getItem('zappi_invite_attempts')).toBe('3')
  })

  it('store reset: prior account state does not survive even before reload', async () => {
    makeDb()
    useAppStore.setState({ txRefreshTrigger: 7 })

    await wipeAccountData(makeDeps())

    expect(useAppStore.getState().txRefreshTrigger).toBe(0)
  })
})
