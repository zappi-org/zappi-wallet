/**
 * deleteCocoData — must not fake silent success when deleting the funds DB.
 *
 * The old version resolved even on onerror/onblocked — if another tab held the DB,
 * the funds DB (proofs) survived intact while logout appeared to succeed.
 * Pins:
 * - resolve only after the DB is actually gone on success
 * - blocked is a waiting state — succeeds once the holding connection closes on versionchange
 * - if it never closes, reject via timeout (the caller must be able to detect failure)
 */
import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import { deleteCocoData } from '@/modules/cashu'

const COCO_DB_NAME = 'zappi-coco-wallet'

function openRawDb(
  name: string,
  opts?: { closeOnVersionChange?: boolean },
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('store')
    }
    req.onsuccess = () => {
      const db = req.result
      if (opts?.closeOnVersionChange) {
        db.onversionchange = () => db.close()
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
}

describe('deleteCocoData', () => {
  it('deletes the DB and resolves when no connection is open', async () => {
    const db = await openRawDb(COCO_DB_NAME)
    db.close()
    expect(await Dexie.exists(COCO_DB_NAME)).toBe(true)

    await deleteCocoData()

    expect(await Dexie.exists(COCO_DB_NAME)).toBe(false)
  })

  it('blocked is a waiting state — succeeds once the connection closes on versionchange', async () => {
    // mirrors the real Dexie-based coco-indexeddb behavior: other tabs auto-close on versionchange
    await openRawDb(COCO_DB_NAME, { closeOnVersionChange: true })

    await deleteCocoData()

    expect(await Dexie.exists(COCO_DB_NAME)).toBe(false)
  })

  it('rejects via timeout if the connection never closes (no faking silent success)', async () => {
    const holder = await openRawDb(COCO_DB_NAME) // ignores versionchange — block persists

    try {
      await expect(deleteCocoData({ timeoutMs: 150 })).rejects.toThrow(/timed out/)
    } finally {
      holder.close()
      // cleanup so the pending delete request completes (avoid polluting the next test file)
      await deleteCocoData().catch(() => undefined)
    }
  })
})
