/**
 * deleteLegacyGraceDatabase — idempotent removal of the legacy zappi-grace DB
 * (fake-indexeddb via setup).
 */
import { describe, it, expect } from 'vitest'
import { deleteLegacyGraceDatabase } from '@/adapters/storage/legacy-grace-cleanup'

const DB_NAME = 'zappi-grace'

function createDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore('grace') }
    req.onsuccess = () => { req.result.close(); resolve() }
    req.onerror = () => reject(req.error)
  })
}

function dbExists(): Promise<boolean> {
  return new Promise((resolve, reject) => {
    let upgraded = false
    const req = indexedDB.open(DB_NAME)
    req.onupgradeneeded = () => { upgraded = true }
    req.onsuccess = () => {
      req.result.close()
      if (upgraded) {
        // The probe itself created it — remove the empty shell again.
        const del = indexedDB.deleteDatabase(DB_NAME)
        del.onsuccess = () => resolve(false)
        del.onerror = () => reject(del.error)
      } else {
        resolve(true)
      }
    }
    req.onerror = () => reject(req.error)
  })
}

describe('deleteLegacyGraceDatabase', () => {
  it('deletes an existing legacy DB', async () => {
    await createDb()
    expect(await dbExists()).toBe(true)

    await deleteLegacyGraceDatabase()

    expect(await dbExists()).toBe(false)
  })

  it('succeeds when the DB does not exist (idempotent boot call)', async () => {
    await expect(deleteLegacyGraceDatabase()).resolves.toBeUndefined()
    await expect(deleteLegacyGraceDatabase()).resolves.toBeUndefined()
  })
})
