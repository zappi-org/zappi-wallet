import { beforeEach, describe, expect, it } from 'vitest'
import { DexieOnchainPayoutStore } from '@/adapters/storage/dexie/dexie-onchain-payout.store'
import type {
  OnchainPayoutRecord,
  OnchainPayoutUpdate,
} from '@/core/ports/driven/onchain-payout-store.port'

function makeRecord(patch: Partial<OnchainPayoutRecord> = {}): OnchainPayoutRecord {
  return {
    id: 'payout-1',
    version: 1,
    providerId: 'fake',
    mintUrl: 'https://mint.example.com',
    destination: 'bcrt1qdestination',
    sendAmount: 100000,
    receiveAmount: 77000,
    stage: 'paying',
    phase: 'submitted',
    providerRef: { v: 1, serverId: 'server-1' },
    payments: [
      {
        request: 'request-a',
        amount: 60000,
        operationId: 'op-a',
        feeReserve: 10,
        status: 'dispatched',
        feePaid: null,
        settledAt: null,
      },
      {
        request: 'request-b',
        amount: 40000,
        operationId: 'op-b',
        feeReserve: 10,
        status: 'prepared',
        feePaid: null,
        settledAt: null,
      },
    ],
    payoutTxId: null,
    failureReason: null,
    publishedAt: null,
    deadline: { blockHeight: 209, estimatedAt: 1700000000000 },
    createdAt: 100,
    updatedAt: 100,
    ...patch,
  }
}

describe('DexieOnchainPayoutStore', () => {
  let store: DexieOnchainPayoutStore

  beforeEach(async () => {
    store = new DexieOnchainPayoutStore()
    await store.wipe()
  })

  it('creates and reads a record with its secrets', async () => {
    const record = makeRecord()
    await store.create(record, 'super-secret-blob')
    expect(await store.get(record.id)).toEqual(record)
    expect(await store.readSecrets(record.id)).toBe('super-secret-blob')
    expect(await store.readSecrets('missing')).toBeNull()
  })

  it('never stores the secrets as plaintext', async () => {
    await store.create(makeRecord(), 'super-secret-blob')
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const request = indexedDB.open('zappi-onchain-payout')
      request.onsuccess = () => {
        const db = request.result
        const tx = db.transaction('payouts', 'readonly')
        const all = tx.objectStore('payouts').getAll()
        all.onsuccess = () => resolve(all.result)
        all.onerror = () => reject(all.error)
      }
      request.onerror = () => reject(request.error)
    })
    expect(JSON.stringify(rows)).not.toContain('super-secret-blob')
  })

  it('updates only on a matching version and increments it', async () => {
    const record = makeRecord()
    await store.create(record, 'secret')
    expect(await store.update(record.id, 99, { stage: 'funded' })).toBe(false)
    expect(await store.update('missing', 1, { stage: 'funded' })).toBe(false)
    expect(
      await store.update(record.id, 1, {
        stage: 'funded',
        phase: 'in_transit',
        publishedAt: 5,
      }),
    ).toBe(true)
    const updated = await store.get(record.id)
    expect(updated?.version).toBe(2)
    expect(updated?.stage).toBe('funded')
    expect(updated?.phase).toBe('in_transit')
    expect(updated?.publishedAt).toBe(5)
    expect(await store.update(record.id, 1, { stage: 'paying' })).toBe(false)
  })

  it('replaces the stored secrets through the conditional update', async () => {
    const record = makeRecord()
    await store.create(record, 'secret-1')
    const changes: OnchainPayoutUpdate = { secrets: 'secret-2', stage: 'sweeping' }
    expect(await store.update(record.id, 1, changes)).toBe(true)
    expect(await store.readSecrets(record.id)).toBe('secret-2')
    expect((await store.get(record.id) as unknown as Record<string, unknown>).secrets).toBeUndefined()
  })

  it('lists active records including terminal ones with pending payments', async () => {
    await store.create(makeRecord({ id: 'active-paying', stage: 'paying' }), 's')
    await store.create(
      makeRecord({
        id: 'completed-pending',
        stage: 'completed',
        phase: 'settled',
        payments: makeRecord().payments.map((payment) => ({
          ...payment,
          status: 'dispatched' as const,
        })),
      }),
      's',
    )
    await store.create(
      makeRecord({
        id: 'completed-paid',
        stage: 'completed',
        phase: 'settled',
        payments: makeRecord().payments.map((payment) => ({
          ...payment,
          status: 'paid' as const,
        })),
      }),
      's',
    )
    await store.create(
      makeRecord({
        id: 'aborted-prepared',
        stage: 'aborted',
        phase: 'failed',
        payments: makeRecord().payments.map((payment) => ({
          ...payment,
          status: 'prepared' as const,
        })),
      }),
      's',
    )
    const ids = (await store.listActive()).map((record) => record.id).sort()
    expect(ids).toEqual(['aborted-prepared', 'active-paying', 'completed-pending'])
  })

  it('lists every record newest first', async () => {
    await store.create(makeRecord({ id: 'old', createdAt: 10 }), 's')
    await store.create(makeRecord({ id: 'new', createdAt: 20 }), 's')
    expect((await store.list()).map((record) => record.id)).toEqual(['new', 'old'])
  })

  it('wipes every record', async () => {
    await store.create(makeRecord(), 's')
    await store.wipe()
    expect(await store.list()).toEqual([])
    expect(await store.get('payout-1')).toBeNull()
  })
})
