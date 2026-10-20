/**
 * DexieSignerSessionStore — signed-event activity persistence.
 *
 * Pins:
 * - logSigned really lands in IndexedDB (a fresh store instance reads it back —
 *   no in-memory carry-over pretending to be persistence)
 * - listRecentSigned is newest-first and capped at `limit` (the "recent 5" screen)
 * - all four signer tables are visible to the wipe's dynamic enumeration
 *   (db.tables) — a rename that escaped it would silently survive logout
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DexieSignerSessionStore } from '@/adapters/storage/dexie/dexie-signer-session.store'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'
import type { SignerSession, SignerSignedEvent } from '@/core/domain/remote-signing'

const CLIENT = 'a'.repeat(64)

function makeSigned(overrides: Partial<SignerSignedEvent> = {}): SignerSignedEvent {
  return {
    id: 'evt-1',
    clientPubkey: CLIENT,
    kind: 1,
    createdAt: 1_700_000_000,
    signedAt: 1_700_000_000_000,
    preview: 'kind 1: hello',
    ...overrides,
  }
}

function makeSession(overrides: Partial<SignerSession> = {}): SignerSession {
  return {
    clientPubkey: CLIENT,
    permissions: [{ method: 'sign_event', kind: 1 }],
    relays: ['wss://relay.example.com'],
    createdAt: 1,
    lastUsedAt: 2,
    ...overrides,
  }
}

describe('DexieSignerSessionStore', () => {
  let store: DexieSignerSessionStore

  beforeEach(async () => {
    await resetDatabase()
    store = new DexieSignerSessionStore()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  it('a logged signature survives a fresh store instance (real persistence)', async () => {
    await store.logSigned(makeSigned())

    const readBack = await new DexieSignerSessionStore().listRecentSigned(5)

    expect(readBack).toEqual([makeSigned()])
  })

  it('returns the newest signatures first, capped at the limit', async () => {
    for (let i = 1; i <= 7; i++) {
      await store.logSigned(makeSigned({ id: `evt-${i}`, signedAt: 1_000 + i }))
    }

    const recent = await store.listRecentSigned(5)

    expect(recent.map((r) => r.id)).toEqual(['evt-7', 'evt-6', 'evt-5', 'evt-4', 'evt-3'])
  })

  it('is empty (not throwing) when nothing was ever signed', async () => {
    await expect(store.listRecentSigned(5)).resolves.toEqual([])
  })

  it('keeps sessions and activity independent — revoking a client does not erase its log', async () => {
    await store.saveSession(makeSession())
    await store.logSigned(makeSigned())

    await store.deleteSession(CLIENT)

    expect(await store.listSessions()).toEqual([])
    expect(await store.listRecentSigned(5)).toHaveLength(1)
  })

  it('exposes every signer table to the logout wipe enumeration (db.tables)', async () => {
    await store.saveSession(makeSession())
    await store.logSigned(makeSigned())
    await store.markProcessed('req:x', 1)
    await store.markSecretUsed('secret-x', 1)

    const tables = getDatabase().tables.map((t) => t.name)
    expect(tables).toEqual(
      expect.arrayContaining([
        'signerActivity',
        'signerProcessed',
        'signerSecrets',
        'signerSessions',
      ]),
    )
  })
})
