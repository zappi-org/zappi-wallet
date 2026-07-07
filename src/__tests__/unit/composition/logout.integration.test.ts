/**
 * wipeAccountData integration — proves every table is destroyed on a real Dexie (fake-indexeddb).
 *
 * No mocking: getDatabase (real schema, 20 tables — legacy proofs dropped in v23),
 * deleteCocoData (real — deletes fake-indexeddb's zappi-coco-wallet), and the real
 * localStorage adapter. Pins that the enumeration drift where the dead clearAllData
 * missed 5 tables (proofs, contacts, etc.) is structurally impossible with dynamic
 * enumeration (db.tables).
 */
import { describe, it, expect, vi } from 'vitest'
import Dexie from 'dexie'
import { getDatabase } from '@/adapters/storage/dexie/schema'
import { DATABASE } from '@/core/constants'
import { wipeAccountData } from '@/composition/logout'

const COCO_DB_NAME = 'zappi-coco-wallet'

/** Actually creates the coco DB — otherwise the "was deleted" assertion is vacuous. */
function seedCocoDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(COCO_DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('proofs')
    }
    req.onsuccess = () => {
      req.result.close()
      resolve()
    }
    req.onerror = () => reject(req.error)
  })
}

describe('wipeAccountData (integration, fake-indexeddb)', () => {
  it('deletes the entire DB even when arbitrary tables hold data', async () => {
    const db = getDatabase()
    // Seed 3 tables of different kinds — including the sort piecewise deletion used to miss
    // (proofs table was dropped from the schema in v23 — seed incomingReviews instead)
    await db.transactions.put({ id: 'tx-1', amount: 21 } as never)
    await db.contacts.put({ id: 'c-1', name: 'alice' } as never)
    await db.incomingReviews.put({ externalId: 'ev-1', mintUrl: 'https://m', token: 't' } as never)
    expect(await db.transactions.count()).toBe(1)

    await seedCocoDb()
    expect(await Dexie.exists(COCO_DB_NAME)).toBe(true)

    localStorage.setItem('zappi-anchor', '{"eventId":"old"}')
    localStorage.setItem('zappi-balance-cache', '{"total":999}')

    await wipeAccountData({
      security: { deleteWallet: vi.fn().mockResolvedValue(undefined) },
      registry: null,
      removePasskey: vi.fn(),
    })

    // both clear and delete succeed — the DB itself must not exist
    expect(await Dexie.exists(DATABASE.NAME)).toBe(false)
    expect(await Dexie.exists(COCO_DB_NAME)).toBe(false)
    expect(localStorage.getItem('zappi-anchor')).toBeNull()
    expect(localStorage.getItem('zappi-balance-cache')).toBeNull()
  })
})
