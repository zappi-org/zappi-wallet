/**
 * SecureStorageAdapter — non-extractable CryptoKey + IndexedDB
 *
 * 지갑 데이터를 non-extractable AES-256-GCM 키로 암호화하여 IndexedDB에 저장.
 * 브라우저 밖에서 디스크 복사해도 복호화 불가.
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
    // 태그 = 외곽 EncryptedRecord 의 iv hex. saveWallet 마다 새 12B 난수라 저장 세대 식별자로 쓴다 (§6.2).
    return { wallet, tag: bytesToHex(record.iv) }
  }

  async saveWallet(wallet: StoredWallet): Promise<void> {
    const record = await this.encryptWallet(wallet)
    await this.dbPut(STORE_NAME, WALLET_KEY, record)
  }

  async replaceWallet(next: StoredWallet, expectedTag: string): Promise<boolean> {
    // 1. 암호화는 트랜잭션 밖에서 완료한다 — IDB 트랜잭션 안에서는 crypto.subtle 을
    //    await 할 수 없다(대기 요청 없이 제어가 이벤트 루프로 돌아가면 자동 커밋). (§6.2)
    const record = await this.encryptWallet(next)
    // 2. 단일 readwrite tx 안에서 get → 동기 태그 비교 → 일치 시에만 put.
    return this.dbReplaceIfTag(record, expectedTag)
  }

  async deleteWallet(): Promise<void> {
    await this.dbDelete(STORE_NAME, WALLET_KEY)
  }

  // ─── Record crypto (트랜잭션 밖) ───

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
   * CAS 전용 트랜잭션 헬퍼 (§6.2). dbGet/dbPut 은 각자 tx 를 열어 재사용 불가하므로 신설.
   *
   * 하나의 readwrite 트랜잭션 안에서 get('current') → onsuccess(동일 태스크)에서 현재
   * 태그(iv hex) == expectedTag 를 **동기 비교** → 일치 시 같은 핸들러에서 put, 불일치·부재 시
   * put 없이 종료. get 과 put 이 같은 트랜잭션·같은 tick 이라 사이에 다른 쓰기가 끼어들 수 없다.
   * 반환: 실제로 put 했는가(true) / no-op(false).
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
          store.put(record, WALLET_KEY) // 같은 tx·동기 발행 — get 과 put 사이 개입 불가
        }
      }
      // put 여부는 tx 커밋 완료 시점에 확정한다 (원자성).
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
