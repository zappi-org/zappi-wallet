/**
 * UnlockGraceAdapter — encrypted grace blob in a dedicated `zappi-grace` DB.
 *
 * Mirrors SecureStorageAdapter's non-extractable-key technique but in its own
 * database so heartbeat writes stay isolated and teardown = deleting one DB
 * (key + blob vanish together). The mnemonic is encrypted under an AES-256-GCM
 * CryptoKey that lives only as a live object in this DB (never extractable to
 * JS); expiresAt is stored as plaintext metadata so expiry can be checked before
 * any decryption.
 */

import type { UnlockGrace, GraceSession } from '@/core/ports/driven/unlock-grace.port'
import { AUTO_LOCK } from '@/core/constants'

const DB_NAME = 'zappi-grace'
const DB_VERSION = 1
const BLOB_STORE = 'blob'
const KEY_STORE = 'keys'
const BLOB_KEY = 'current'
const GRACE_KEY_ID = 'grace-key'
const DELETE_TIMEOUT_MS = 10_000
// Stored expiresAt is attacker-writable plaintext metadata. The app can never
// legitimately write an expiry further out than the maximum timeout (+1 min
// clock slack), so anything beyond that horizon is tampered/corrupt.
const MAX_EXPIRY_HORIZON_MS = AUTO_LOCK.MAX_TIMEOUT_MINUTES * 60_000 + 60_000

interface GraceRecord {
  ciphertext: ArrayBuffer
  iv: Uint8Array
  /** Plaintext metadata — lets load() check expiry before decrypting. */
  expiresAt: number
}

// Module-scoped connection + key cache. Grace is a device-global resource, and
// deleteGraceDatabase must close the live connection AND drop the cached key so
// the delete isn't blocked and a later save can't reuse a key whose store was
// destroyed — so both live at module scope, shared by the singleton adapter
// rather than hidden in instance fields.
let dbPromise: Promise<IDBDatabase> | null = null
let cachedKey: CryptoKey | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE)
        if (!db.objectStoreNames.contains(KEY_STORE)) db.createObjectStore(KEY_STORE)
      }
      request.onsuccess = () => {
        const db = request.result
        // A delete/upgrade in another tab (logout wipe) blocks until every
        // connection closes — close eagerly and drop the caches so this tab
        // can never stall a wipe or keep using a handle to a destroyed DB.
        db.onversionchange = () => {
          db.close()
          dbPromise = null
          cachedKey = null
        }
        resolve(db)
      }
      request.onerror = () => {
        // Never cache a failed open — the next call should retry cleanly.
        dbPromise = null
        reject(request.error)
      }
    })
  }
  return dbPromise
}

// Avoid recreating an empty DB shell after teardown: load/extend/clear check
// existence first so a resume attempt on a wiped device (or after logout) never
// re-materializes `zappi-grace`. save() is the only method allowed to create it.
async function graceDbExists(): Promise<boolean> {
  if (typeof indexedDB.databases !== 'function') return true
  const dbs = await indexedDB.databases()
  return dbs.some((d) => d.name === DB_NAME)
}

export class UnlockGraceAdapter implements UnlockGrace {
  async save(mnemonic: string, expiresAt: number): Promise<void> {
    const key = await this.getOrCreateKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(mnemonic)
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
    await this.put(BLOB_STORE, BLOB_KEY, { ciphertext, iv, expiresAt } satisfies GraceRecord)
  }

  async load(): Promise<GraceSession | null> {
    if (!(await graceDbExists())) return null
    const record = await this.get<GraceRecord>(BLOB_STORE, BLOB_KEY)
    if (!record) return null

    // Expiry is checked before decrypting — a dead blob never touches the key.
    // Over-horizon expiries fail closed too: honoring one would turn a tampered
    // record into an indefinite PIN bypass.
    if (Date.now() >= record.expiresAt || record.expiresAt > Date.now() + MAX_EXPIRY_HORIZON_MS) {
      await this.clear()
      return null
    }

    try {
      const key = await this.getOrCreateKey()
      const decrypted = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: record.iv as Uint8Array<ArrayBuffer> },
        key,
        record.ciphertext,
      )
      const mnemonic = new TextDecoder().decode(decrypted)
      return { mnemonic, expiresAt: record.expiresAt }
    } catch {
      // Corrupt/undecryptable blob — clear and fall back to PIN (never weakens lock).
      await this.clear()
      return null
    }
  }

  async extend(expiresAt: number): Promise<void> {
    if (!(await graceDbExists())) return
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(BLOB_STORE, 'readwrite')
      const store = tx.objectStore(BLOB_STORE)
      const getReq = store.get(BLOB_KEY)
      getReq.onsuccess = () => {
        const current = getReq.result as GraceRecord | undefined
        // Non-creating, non-reviving: refresh only a live blob. A cleared or
        // expired blob is left untouched so a racing heartbeat can't resurrect it.
        // The written expiry is capped to the legitimate horizon regardless of
        // what the caller computed.
        if (current && Date.now() < current.expiresAt) {
          const capped = Math.min(expiresAt, Date.now() + MAX_EXPIRY_HORIZON_MS)
          store.put({ ...current, expiresAt: capped }, BLOB_KEY)
        }
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('grace extend transaction aborted'))
    })
  }

  async clear(): Promise<void> {
    if (!(await graceDbExists())) return
    try {
      const db = await openDb()
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(BLOB_STORE, 'readwrite')
        tx.objectStore(BLOB_STORE).delete(BLOB_KEY)
        // Resolve on commit (oncomplete), not request success — an awaited clear must
        // prove the blob is durably gone before the caller flips the UI to locked.
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error ?? new Error('grace clear transaction aborted'))
      })
    } catch (error) {
      // A clear that silently fails would leave a PIN-free copy behind a lock
      // screen. Escalate: destroying the whole DB kills the non-extractable key,
      // so even a surviving blob becomes undecryptable. Only a double failure
      // propagates.
      console.error('[UnlockGrace] clear failed — escalating to full DB delete:', error)
      await deleteGraceDatabase()
    }
  }

  // ─── Non-extractable key management ───

  private async getOrCreateKey(): Promise<CryptoKey> {
    if (cachedKey) return cachedKey

    const existing = await this.get<CryptoKey>(KEY_STORE, GRACE_KEY_ID)
    if (existing) {
      cachedKey = existing
      return existing
    }

    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable
      ['encrypt', 'decrypt'],
    )
    await this.put(KEY_STORE, GRACE_KEY_ID, key)
    cachedKey = key
    return key
  }

  // ─── IndexedDB helpers ───

  private async get<T>(storeName: string, key: string): Promise<T | null> {
    const db = await openDb()
    return new Promise<T | null>((resolve, reject) => {
      const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error)
    })
  }

  private async put(storeName: string, key: string, value: unknown): Promise<void> {
    const db = await openDb()
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      tx.objectStore(storeName).put(value, key)
      // Resolve on commit (oncomplete), not request success — an awaited save must
      // prove the transaction committed, not merely that the put request fired.
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error(`grace ${storeName} put aborted`))
    })
  }
}

/**
 * Destroy the entire dedicated DB (key + blob). The authoritative grace teardown
 * for logout — closes this tab's live connection first so the delete isn't
 * blocked, and rejects on failure so a half-completed wipe surfaces (never leaves
 * a PIN-free mnemonic copy beside a destroyed account).
 */
export async function deleteGraceDatabase(opts?: { timeoutMs?: number }): Promise<void> {
  if (dbPromise) {
    try {
      ;(await dbPromise).close()
    } catch {
      // already closed / never opened
    }
    dbPromise = null
  }
  cachedKey = null
  const timeoutMs = opts?.timeoutMs ?? DELETE_TIMEOUT_MS
  await new Promise<void>((resolve, reject) => {
    // blocked is transient: other tabs close on versionchange, then onsuccess
    // fires. Only the timeout turns a stuck delete into a hard failure so a
    // wipe can never fake success while the blob survives.
    const timer = setTimeout(() => {
      reject(new Error(`zappi-grace delete timed out after ${timeoutMs}ms (blocked by another connection?)`))
    }, timeoutMs)
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => {
      clearTimeout(timer)
      resolve()
    }
    request.onerror = () => {
      clearTimeout(timer)
      reject(request.error ?? new Error('zappi-grace delete failed'))
    }
    request.onblocked = () => {}
  })
}
