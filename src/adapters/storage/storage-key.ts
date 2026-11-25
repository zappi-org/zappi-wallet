
export const SECURE_DB_NAME = 'zappi-secure'
export const SECURE_DB_VERSION = 1
export const WALLET_STORE_NAME = 'wallet'
export const KEY_STORE_NAME = 'keys'
export const STORAGE_KEY_ID = 'storage-key'

export interface EncryptedAtRest {
  iv: Uint8Array
  ciphertext: ArrayBuffer
}

let databasePromise: Promise<IDBDatabase> | null = null
let keyPromise: Promise<CryptoKey> | null = null

export function getSecureDatabase(): Promise<IDBDatabase> {
  if (!databasePromise) {
    databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(SECURE_DB_NAME, SECURE_DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(WALLET_STORE_NAME)) {
          db.createObjectStore(WALLET_STORE_NAME)
        }
        if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
          db.createObjectStore(KEY_STORE_NAME)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }
  return databasePromise
}

async function readKey(): Promise<CryptoKey | null> {
  const db = await getSecureDatabase()
  return new Promise<CryptoKey | null>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readonly')
    const request = tx.objectStore(KEY_STORE_NAME).get(STORAGE_KEY_ID)
    request.onsuccess = () => resolve((request.result as CryptoKey | undefined) ?? null)
    request.onerror = () => reject(request.error)
  })
}

async function writeKey(key: CryptoKey): Promise<void> {
  const db = await getSecureDatabase()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(KEY_STORE_NAME, 'readwrite')
    const request = tx.objectStore(KEY_STORE_NAME).put(key, STORAGE_KEY_ID)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function loadOrCreateKey(): Promise<CryptoKey> {
  const existing = await readKey()
  if (existing) return existing
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  await writeKey(key)
  return key
}

export function getStorageKey(): Promise<CryptoKey> {
  if (!keyPromise) {
    keyPromise = loadOrCreateKey().catch((error: unknown) => {
      keyPromise = null
      throw error
    })
  }
  return keyPromise
}

export async function encryptAtRest(plaintext: string): Promise<EncryptedAtRest> {
  const key = await getStorageKey()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return { iv, ciphertext }
}

export async function decryptAtRest(record: EncryptedAtRest): Promise<string> {
  const key = await getStorageKey()
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: record.iv as Uint8Array<ArrayBuffer> },
    key,
    record.ciphertext,
  )
  return new TextDecoder().decode(decrypted)
}
