/**
 * wipeAccountData integration — proves every table is destroyed on a real Dexie (fake-indexeddb).
 *
 * No mocking: getDatabase (real schema, 20 tables — legacy proofs dropped in v23),
 * deleteCocoData (real — deletes fake-indexeddb's zappi-coco-wallet), and the real
 * localStorage adapter. Pins that the enumeration drift where the dead clearAllData
 * missed 5 tables (proofs, contacts, etc.) is structurally impossible with dynamic
 * enumeration (db.tables).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'
import { DexieSignerSessionStore } from '@/adapters/storage/dexie/dexie-signer-session.store'
import { DATABASE } from '@/core/constants'
import { wipeAccountData } from '@/composition/logout'
import type { SignerSignedEvent } from '@/core/domain/remote-signing'

const COCO_DB_NAME = 'zappi-coco-wallet'

const SIGNED: SignerSignedEvent = {
  id: 'signed-1',
  clientPubkey: 'a'.repeat(64),
  kind: 1,
  createdAt: 1_700_000_000,
  signedAt: 1_700_000_000_000,
  preview: 'kind 1: hello',
}

/** Seed all four NIP-46 tables through the real store adapter. */
async function seedSignerData(): Promise<DexieSignerSessionStore> {
  const signerStore = new DexieSignerSessionStore()
  await signerStore.saveSession({
    clientPubkey: SIGNED.clientPubkey,
    permissions: [{ method: 'sign_event', kind: 1 }],
    relays: ['wss://relay.example.com'],
    createdAt: 1,
    lastUsedAt: 2,
  })
  await signerStore.logSigned(SIGNED)
  await signerStore.markProcessed('req:x', 1)
  await signerStore.markSecretUsed('secret-x', 1)
  return signerStore
}

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
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

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

  it('erases NIP-46 signer state: sessions, anti-replay ledgers and signed-event log', async () => {
    const signerStore = await seedSignerData()
    // Non-vacuous: the rows are really there before the wipe.
    expect(await signerStore.listRecentSigned(5)).toEqual([SIGNED])
    expect(await signerStore.listSessions()).toHaveLength(1)

    await wipeAccountData({
      security: { deleteWallet: vi.fn().mockResolvedValue(undefined) },
      registry: null,
      removePasskey: vi.fn(),
    })

    expect(await Dexie.exists(DATABASE.NAME)).toBe(false)
    // Reopen a brand-new DB from the schema (what a post-logout page reload does).
    await resetDatabase()
    expect(await new DexieSignerSessionStore().listRecentSigned(5)).toEqual([])
    expect(await new DexieSignerSessionStore().listSessions()).toEqual([])
    expect(await new DexieSignerSessionStore().hasProcessed('req:x')).toBe(false)
    expect(await new DexieSignerSessionStore().hasUsedSecret('secret-x')).toBe(false)
  })

  /**
   * The contract that matters for a newly added table: `db.delete()` is
   * best-effort, so erasure must already be complete via the clear pass.
   */
  it('erases the signed-event log even when db.delete() is blocked', async () => {
    const signerStore = await seedSignerData()
    expect(await signerStore.listRecentSigned(5)).toHaveLength(1)
    const db = getDatabase()
    const deleteSpy = vi.spyOn(db, 'delete').mockRejectedValue(new Error('blocked by another tab'))

    await wipeAccountData({
      security: { deleteWallet: vi.fn().mockResolvedValue(undefined) },
      registry: null,
      removePasskey: vi.fn(),
    })
    deleteSpy.mockRestore()

    expect(db.isOpen()).toBe(true) // DB shell survived, as designed
    expect(await db.signerActivity.count()).toBe(0)
    expect(await db.signerSessions.count()).toBe(0)
    expect(await db.signerProcessed.count()).toBe(0)
    expect(await db.signerSecrets.count()).toBe(0)
  })
})
