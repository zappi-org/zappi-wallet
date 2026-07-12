/**
 * v22→v23 schema migration pin (drops the legacy proofs table).
 *
 * This codebase relies on a single latest-version declaration + Dexie schema-diff
 * upgrades (same pattern as the failedSwaps/processedEvents tombstones). Pinned
 * contract: when an existing user (v22 install) opens v23,
 *   ① surviving tables' data passes through losslessly, and
 *   ② the proofs object store is dropped (`proofs: null`).
 * proofs is legacy left over after the coco migration — it has no read/write
 * path, so the data itself is slated for deletion.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'
import { DATABASE } from '@/core/constants'

/** Simulate a v22 install — create the old schema (incl. proofs) and seed data */
async function seedV22Database(): Promise<void> {
  const old = new Dexie(DATABASE.NAME)
  old.version(22).stores({
    transactions: 'id, direction, type, status, createdAt, mintUrl, source, operationId',
    contacts: 'id, name, address, addressType, createdAt',
    proofs: 'id, mintUrl, secret',
  })
  await old.open()
  await old.table('transactions').put({ id: 'tx-1', amount: 21 })
  await old.table('contacts').put({ id: 'c-1', name: 'alice' })
  await old.table('proofs').put({ id: 'p-1', mintUrl: 'https://m', secret: 's', amount: 8 })
  old.close()
}

describe('ZappiDatabase v22→v23 migration (drops proofs)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  it('surviving tables pass through losslessly, proofs store is dropped', async () => {
    await seedV22Database()

    const db = getDatabase()
    await db.open()

    // ① surviving tables lossless
    expect(await db.transactions.get('tx-1')).toMatchObject({ id: 'tx-1', amount: 21 })
    expect(await db.contacts.get('c-1')).toMatchObject({ id: 'c-1', name: 'alice' })

    // ② the proofs object store itself is gone (both schema and actual IDB)
    expect(db.tables.map((t) => t.name)).not.toContain('proofs')
    expect(Array.from(db.backendDB().objectStoreNames)).not.toContain('proofs')
  })
})
