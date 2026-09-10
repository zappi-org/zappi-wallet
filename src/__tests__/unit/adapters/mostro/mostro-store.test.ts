import { describe, it, expect } from 'vitest'
import { createMostroStore } from '@/adapters/mostro'
import { deriveMostroStoreKey } from '@/adapters/mostro'

function rawGet(dbName: string, storeName: string, key: IDBValidKey): Promise<Record<string, unknown> | undefined> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 2)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const db = req.result
      const tx = db.transaction(storeName, 'readonly')
      const getReq = tx.objectStore(storeName).get(key)
      getReq.onerror = () => reject(getReq.error)
      getReq.onsuccess = () => {
        resolve(getReq.result as Record<string, unknown> | undefined)
        db.close()
      }
    }
  })
}

describe('createMostroStore', () => {
  it('encrypts trade_keys at rest, never plaintext', async () => {
    const seed = new Uint8Array(64).fill(9)
    const dbName = `zappi-mostro-test-${Math.random().toString(36).slice(2)}`
    const store = createMostroStore(seed, dbName)

    await store.saveOrder({
      id: 'ord-1',
      kind: 'sell',
      status: 'pending',
      amount: 1000,
      fiat_code: 'USD',
      min_amount: null,
      max_amount: null,
      fiat_amount: 5,
      payment_method: 'TESTINGFROM-ZAPPI',
      premium: 0,
      trade_keys: 'deadbeefsecret',
      counterparty_pubkey: null,
      is_mine: false,
      buyer_invoice: null,
      request_id: null,
      trade_index: 1,
      created_at: 1,
      expires_at: null,
    })

    const raw = await rawGet(dbName, 'orders', 'ord-1')
    expect(raw?.trade_keys).toMatch(/^b1x/)
    expect(String(raw?.trade_keys)).not.toContain('deadbeefsecret')

    await store.close()
  })

  it('stores no key material in the user row', async () => {
    const seed = new Uint8Array(64).fill(4)
    const dbName = `zappi-mostro-test-${Math.random().toString(36).slice(2)}`
    const store = createMostroStore(seed, dbName)
    const pubkey = 'a'.repeat(64)

    await store.upsertUser({ i0_pubkey: pubkey, last_trade_index: 0, created_at: 1 })
    const raw = await rawGet(dbName, 'users', pubkey)
    expect(raw && 'mnemonic' in raw).toBe(false)
    expect(raw?.last_trade_index).toBe(0)

    await store.close()
  })

  it('uses a domain-separated 32-byte key independent of the raw seed', () => {
    const seed = new Uint8Array(64).fill(1)
    const key = deriveMostroStoreKey(seed)
    expect(key).toHaveLength(32)
    expect(Array.from(key)).not.toEqual(Array.from(seed.subarray(0, 32)))
  })
})
