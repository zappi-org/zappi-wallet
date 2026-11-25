/**
 * SecureStorageAdapter — non-extractable CryptoKey + IndexedDB
 *
 * Encrypts wallet data with a non-extractable AES-256-GCM key and stores it in IndexedDB.
 * Copying the data off disk outside the browser can't decrypt it.
 */

import type { SecureStorage, StoredWallet } from '@/core/ports/driven/secure-storage.port'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  decryptAtRest,
  encryptAtRest,
  getSecureDatabase,
  WALLET_STORE_NAME,
  type EncryptedAtRest,
} from './storage-key'

const STORE_NAME = WALLET_STORE_NAME
const WALLET_KEY = 'current'

export class SecureStorageAdapter implements SecureStorage {
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
    return JSON.parse(await decryptAtRest(record))
  }

  private async encryptWallet(wallet: StoredWallet): Promise<EncryptedRecord> {
    return encryptAtRest(JSON.stringify(wallet))
  }

  // ─── IndexedDB helpers ───

  private async dbGet<T>(storeName: string, key: string): Promise<T | null> {
    const db = await getSecureDatabase()
    return new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly')
      const store = tx.objectStore(storeName)
      const request = store.get(key)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => reject(request.error)
    })
  }

  private async dbPut(storeName: string, key: string, value: unknown): Promise<void> {
    const db = await getSecureDatabase()
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite')
      const store = tx.objectStore(storeName)
      const request = store.put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  private async dbDelete(storeName: string, key: string): Promise<void> {
    const db = await getSecureDatabase()
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
    const db = await getSecureDatabase()
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

type EncryptedRecord = EncryptedAtRest
