/**
 * SecureStorageAdapter — non-extractable CryptoKey + IndexedDB
 *
 * 지갑 데이터를 non-extractable AES-256-GCM 키로 암호화하여 IndexedDB에 저장.
 * 브라우저 밖에서 디스크 복사해도 복호화 불가.
 */

import type { SecureStorage, StoredWallet } from '@/core/ports/driven/secure-storage.port'

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

    const key = await this.getOrCreateKey()
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: record.iv as Uint8Array<ArrayBuffer> },
      key,
      record.ciphertext,
    )

    return JSON.parse(new TextDecoder().decode(decrypted))
  }

  async saveWallet(wallet: StoredWallet): Promise<void> {
    const key = await this.getOrCreateKey()
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const plaintext = new TextEncoder().encode(JSON.stringify(wallet))

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      plaintext,
    )

    const record: EncryptedRecord = { iv, ciphertext }
    await this.dbPut(STORE_NAME, WALLET_KEY, record)
  }

  async deleteWallet(): Promise<void> {
    await this.dbDelete(STORE_NAME, WALLET_KEY)
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
}

// ─── Internal type ───

interface EncryptedRecord {
  iv: Uint8Array
  ciphertext: ArrayBuffer
}
