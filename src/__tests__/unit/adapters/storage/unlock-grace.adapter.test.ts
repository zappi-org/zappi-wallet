/**
 * UnlockGraceAdapter — encrypted round-trip, expiry self-delete, corruption
 * fallback, non-creating extend, clear, and dedicated-DB teardown.
 * Verified on real fake-indexeddb + crypto.subtle (no mocking).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { UnlockGraceAdapter, deleteGraceDatabase } from '@/adapters/storage/unlock-grace.adapter'

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const DB_NAME = 'zappi-grace'

async function graceDbExists(): Promise<boolean> {
  const dbs = await indexedDB.databases()
  return dbs.some((d) => d.name === DB_NAME)
}

describe('UnlockGraceAdapter', () => {
  let adapter: UnlockGraceAdapter

  beforeEach(async () => {
    await deleteGraceDatabase() // fresh DB + reset module key cache each test
    adapter = new UnlockGraceAdapter()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('round-trips the mnemonic and expiry', async () => {
    const expiresAt = Date.now() + 60_000
    await adapter.save(MNEMONIC, expiresAt)

    const session = await adapter.load()
    expect(session).not.toBeNull()
    expect(session!.mnemonic).toBe(MNEMONIC)
    expect(session!.expiresAt).toBe(expiresAt)
  })

  it('does not persist the mnemonic in plaintext', async () => {
    await adapter.save(MNEMONIC, Date.now() + 60_000)
    const raw = await rawBlob()
    // Stored record carries ciphertext + iv, never the plaintext words.
    expect(new TextDecoder().decode(new Uint8Array(raw!.ciphertext))).not.toContain('abandon')
    expect(typeof raw!.expiresAt).toBe('number') // expiry is plaintext metadata
  })

  it('expired blob → load returns null and self-deletes', async () => {
    await adapter.save(MNEMONIC, Date.now() - 1) // already expired
    expect(await adapter.load()).toBeNull()
    expect(await rawBlob()).toBeNull() // deleted, not just hidden
  })

  it('corrupt blob → load returns null and clears', async () => {
    await adapter.save(MNEMONIC, Date.now() + 60_000)
    // Overwrite ciphertext with garbage the key can't authenticate.
    await writeRawBlob({ ciphertext: new Uint8Array([1, 2, 3]).buffer, iv: crypto.getRandomValues(new Uint8Array(12)), expiresAt: Date.now() + 60_000 })
    expect(await adapter.load()).toBeNull()
    expect(await rawBlob()).toBeNull()
  })

  it('extend refreshes a live blob', async () => {
    const first = Date.now() + 30_000
    await adapter.save(MNEMONIC, first)
    const later = Date.now() + 90_000
    await adapter.extend(later)
    const session = await adapter.load()
    expect(session!.expiresAt).toBe(later)
  })

  it('extend is non-creating on empty state (no revive)', async () => {
    await adapter.extend(Date.now() + 60_000)
    expect(await adapter.load()).toBeNull()
    expect(await rawBlob()).toBeNull()
  })

  it('extend is non-reviving on an expired blob', async () => {
    await adapter.save(MNEMONIC, Date.now() - 1) // expired
    await adapter.extend(Date.now() + 60_000)
    // A buggy revive would make load() succeed; correct no-op keeps it dead.
    expect(await adapter.load()).toBeNull()
  })

  it('clear removes the blob', async () => {
    await adapter.save(MNEMONIC, Date.now() + 60_000)
    await adapter.clear()
    expect(await adapter.load()).toBeNull()
    expect(await rawBlob()).toBeNull()
  })

  it('deleteGraceDatabase destroys the dedicated DB', async () => {
    await adapter.save(MNEMONIC, Date.now() + 60_000)
    expect(await graceDbExists()).toBe(true)
    await deleteGraceDatabase()
    expect(await graceDbExists()).toBe(false)
  })

  it('load / extend / clear do not recreate the DB after teardown', async () => {
    await adapter.save(MNEMONIC, Date.now() + 60_000)
    await deleteGraceDatabase()
    expect(await adapter.load()).toBeNull()
    await adapter.extend(Date.now() + 60_000)
    await adapter.clear()
    expect(await graceDbExists()).toBe(false) // still gone — no empty shell
  })
})

// ─── raw store access (bypasses the adapter to inspect persisted bytes) ───

interface RawRecord {
  ciphertext: ArrayBuffer
  iv: Uint8Array
  expiresAt: number
}

function openRaw(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('blob')) db.createObjectStore('blob')
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function rawBlob(): Promise<RawRecord | null> {
  const db = await openRaw()
  try {
    return await new Promise<RawRecord | null>((resolve, reject) => {
      const req = db.transaction('blob', 'readonly').objectStore('blob').get('current')
      req.onsuccess = () => resolve((req.result as RawRecord) ?? null)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

async function writeRawBlob(record: RawRecord): Promise<void> {
  const db = await openRaw()
  try {
    await new Promise<void>((resolve, reject) => {
      const req = db.transaction('blob', 'readwrite').objectStore('blob').put(record, 'current')
      req.onsuccess = () => resolve()
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}
