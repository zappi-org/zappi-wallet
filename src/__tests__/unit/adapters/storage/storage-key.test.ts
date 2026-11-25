import { beforeEach, describe, expect, it, vi } from 'vitest'

const DB_NAME = 'zappi-secure'

async function clearKeys(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('keys')
    }
    request.onsuccess = () => {
      const db = request.result
      const tx = db.transaction('keys', 'readwrite')
      tx.objectStore('keys').clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }
    request.onerror = () => reject(request.error)
  })
}

describe('storage key', () => {
  beforeEach(async () => {
    vi.resetModules()
    await clearKeys()
  })

  it('hands the same key to concurrent first callers', async () => {
    const { getStorageKey } = await import('@/adapters/storage/storage-key')
    const [first, second] = await Promise.all([getStorageKey(), getStorageKey()])
    expect(first).toBe(second)

    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME)
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('keys', 'readonly')
        const all = tx.objectStore('keys').getAll()
        all.onsuccess = () => resolve(all.result)
        all.onerror = () => reject(all.error)
      }
      request.onerror = () => reject(request.error)
    })
    expect(stored).toHaveLength(1)
  })

  it('round trips encrypted text', async () => {
    const { encryptAtRest, decryptAtRest } = await import('@/adapters/storage/storage-key')
    const record = await encryptAtRest('wallet-secret')
    expect(await decryptAtRest(record)).toBe('wallet-secret')
    expect(new TextDecoder().decode(record.ciphertext)).not.toBe('wallet-secret')
  })
})
