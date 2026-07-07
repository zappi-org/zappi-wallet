/**
 * SecureStorageAdapter — non-extractable CryptoKey + IndexedDB
 *
 * Encrypts wallet data with a non-extractable AES-256-GCM key and stores it in IndexedDB.
 * Copying the data off disk outside the browser can't decrypt it.
 */

import type { SecureStorage, StoredWallet } from '@/core/ports/driven/secure-storage.port'
import { bytesToHex } from '@noble/hashes/utils.js'

const DB_NAME = 'zappi-secure'
const DB_VERSION = 1
const STORE_NAME = 'wallet'
const KEY_STORE_NAME = 'keys'
const WALLET_KEY = 'current'
const CRYPTO_KEY_ID = 'storage-key'

export class SecureStorageAdapter implements SecureStorage {
  private dbPromise: Promise<IDBDatabase> | null = null
  private cachedKey: CryptoKey | null = null

  async getWallet(): Promise<StoredWallet | null> {
    const record = await this.dbGet<EncryptedRecord>(STORE_NAME, WALLET_KEY)
    if (!record) return null
    return this.decryptRecord(record)
  }

  async getWalletWithTag(): Promise<{ wallet: StoredWallet; tag: string } | null> {
    const record = await this.dbGet<EncryptedRecord>(STORE_NAME, WALLET_KEY)
    if (!record) return null
    const wallet = await this.decryptRecord(record)
    // Tag = the outer EncryptedRecord's iv hex. Each saveWallet uses a fresh 12-byte random value, so it serves as a storage-generation identifier.
    return { wallet, tag: bytesToHex(record.iv) }
  }

  async saveWallet(wallet: StoredWallet): Promise<void> {
    const record = await this.encryptWallet(wallet)
    await this.dbPut(STORE_NAME, WALLET_KEY, record)
  }

  async replaceWallet(next: StoredWallet, expectedTag: string): Promise<boolean> {
    // 1. Finish encryption outside the transaction — you can't await crypto.subtle inside
    //    an IDB transaction (it auto-commits when control returns to the event loop with no pending request).
    const record = await this.encryptWallet(next)
    // 2. Within a single readwrite tx: get → synchronous tag compare → put only if it matches.
    return this.dbReplaceIfTag(record, expectedTag)
  }

  async deleteWallet(): Promise<void> {
    await this.dbDelete(STORE_NAME, WALLET_KEY)
  }

  // ─── Record crypto (outside the transaction) ───

  private async decryptRecord(record: EncryptedRecord): Promise<StoredWallet> {
    const key = await this.getOrCreateKey()
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv as Uint8Array<ArrayBuffer> },
      key,
      record.ciphertext,
    )
    return JSON.parse(new TextDecoder().decode(decrypted))
  }

  private async encryptWallet(wallet: StoredWallet): Promise<EncryptedRecord> {
    const key = await this.getOrCreateKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(JSON.stringify(wallet))
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
    return { iv, ciphertext }
  }

  // ─── Non-extractable key management ───

  private async getOrCreateKey(): Promise<CryptoKey> {
    if (this.cachedKey) return this.cachedKey

    const existing = await this.dbGet<CryptoKey>(KEY_STORE_NAME, CRYPTO_KEY_ID)
    if (existing) {
      this.cachedKey = existing
      return existing
    }

    const key = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false, // non-extractable
      ['encrypt', 'decrypt'],
    )

    await this.dbPut(KEY_STORE_NAME, CRYPTO_KEY_ID, key)
    this.cachedKey = key
    return key
  }

  // ─── IndexedDB helpers ───

  private openDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION)

        request.onupgradeneeded = () => {
          const db = request.result
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME)
          }
          if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
            db.createObjectStore(KEY_STORE_NAME)
          }
        }

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
    }
    return this.dbPromise
  }

  private async dbGet<T>(storeName: string, key: string): Promise<T | null> {
    const db = await this.openDb()
    return new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error)
    })
  }

  private async dbPut(storeName: string, key: string, value: unknown): Promise<void> {
    const db = await this.openDb()
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      const request = store.put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private async dbDelete(storeName: string, key: string): Promise<void> {
    const db = await this.openDb()
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      const request = store.delete(key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  /**
   * CAS-only transaction helper. Added because dbGet/dbPut each open their own tx and can't be reused.
   *
   * Within one readwrite transaction: get('current') → in onsuccess (same task) synchronously
   * compare the current tag (iv hex) == expectedTag → put in the same handler if it matches, else
   * finish without put. get and put share the same transaction and tick, so no other write can
   * slip in between. Returns whether it actually put (true) / no-op (false).
   */
  private async dbReplaceIfTag(record: EncryptedRecord, expectedTag: string): Promise<boolean> {
    const db = await this.openDb()
    return new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const getReq = store.get(WALLET_KEY)
      let willPut = false
      getReq.onsuccess = () => {
        const current = getReq.result as EncryptedRecord | undefined
        if (current && bytesToHex(current.iv) === expectedTag) {
          willPut = true
          store.put(record, WALLET_KEY) // same tx, synchronous issue — nothing can intervene between get and put
        }
      }
      // The put outcome is finalized at tx-commit completion (atomicity).
      tx.oncomplete = () => resolve(willPut)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('replaceWallet transaction aborted'))
    })
  }
}

// ─── Internal type ───

interface EncryptedRecord {
  iv: Uint8Array
  ciphertext: ArrayBuffer
}
