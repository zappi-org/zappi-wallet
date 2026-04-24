import { beforeEach, describe, expect, it } from 'vitest'
import { resetDatabase, getDatabase } from '@/adapters/storage/dexie/schema'
import { DexieReceiveRequestRepository } from '@/adapters/storage/dexie/dexie-receive-request.repository'
import { sat } from '@/core/domain/amount'
import { createReceiveMethod, createReceiveRequest, completeReceiveRequest } from '@/core/domain/receive-request'

describe('DexieReceiveRequestRepository', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('round-trips canonical fulfillment and method statuses', async () => {
    const repo = new DexieReceiveRequestRepository()
    const request = completeReceiveRequest(createReceiveRequest({
      id: 'request-1',
      amount: sat(1000),
      accountId: 'https://mint.test',
      createdAt: 1_000,
      expiresAt: 10_000,
      paymentMethods: [
        createReceiveMethod({ type: 'bolt11', ref: 'quote-1', encoded: 'lnbc...', expiresAt: 10_000 }),
        createReceiveMethod({ type: 'ecash', ref: 'ecash-1', encoded: 'creq...', expiresAt: 10_000 }),
      ],
    }), 'ecash', 2_000)

    await repo.save(request)

    const saved = await repo.getById('request-1')
    expect(saved?.fulfillmentStatus).toBe('fulfilled')
    expect(saved?.fulfilledBy).toBe('ecash')
    expect(saved?.paymentMethods.find((method) => method.type === 'ecash')?.status).toBe('received')
    expect(saved?.paymentMethods.find((method) => method.type === 'bolt11')?.status).toBe('active')
  })

  it('maps legacy completed lightning records to fulfilled bolt11 method state', async () => {
    await getDatabase().receiveRequests.put({
      id: 'legacy-request',
      status: 'completed',
      amount: 1000,
      mintUrl: 'https://mint.test',
      createdAt: 1_000,
      expiresAt: 10_000,
      quoteId: 'quote-1',
      invoice: 'lnbc...',
      ecashRequest: 'creq...',
      ecashRequestId: 'ecash-1',
      completedAt: 2_000,
      completedMethod: 'lightning',
    })

    const repo = new DexieReceiveRequestRepository()
    const request = await repo.getById('legacy-request')

    expect(request?.fulfillmentStatus).toBe('fulfilled')
    expect(request?.fulfilledBy).toBe('bolt11')
    expect(request?.paymentMethods.find((method) => method.type === 'bolt11')?.status).toBe('received')
    expect(request?.paymentMethods.find((method) => method.type === 'ecash')?.status).toBe('active')
  })

  it('listPending excludes fulfilled requests', async () => {
    const repo = new DexieReceiveRequestRepository()
    await repo.save(createReceiveRequest({
      id: 'pending-request',
      amount: sat(1000),
      accountId: 'https://mint.test',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      paymentMethods: [
        createReceiveMethod({ type: 'bolt11', ref: 'quote-1', encoded: 'lnbc...', expiresAt: Date.now() + 60_000 }),
      ],
    }))
    await repo.save(completeReceiveRequest(createReceiveRequest({
      id: 'fulfilled-request',
      amount: sat(1000),
      accountId: 'https://mint.test',
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      paymentMethods: [
        createReceiveMethod({ type: 'bolt11', ref: 'quote-2', encoded: 'lnbc...', expiresAt: Date.now() + 60_000 }),
      ],
    }), 'bolt11', Date.now()))

    const pending = await repo.listPending()
    expect(pending.map((request) => request.id)).toEqual(['pending-request'])
  })

  it('updates by payment ref without losing the other method state', async () => {
    const repo = new DexieReceiveRequestRepository()
    await repo.save(createReceiveRequest({
      id: 'request-1',
      amount: sat(1000),
      accountId: 'https://mint.test',
      createdAt: 1_000,
      expiresAt: 10_000,
      paymentMethods: [
        createReceiveMethod({ type: 'bolt11', ref: 'quote-1', encoded: 'lnbc...', expiresAt: 10_000 }),
        createReceiveMethod({ type: 'ecash', ref: 'ecash-1', encoded: 'creq...', expiresAt: 10_000 }),
      ],
    }))

    await repo.updateByPaymentRef('ecash-1', (request) => completeReceiveRequest(request, 'ecash', 2_000))
    await repo.updateByPaymentRef('quote-1', (request) => completeReceiveRequest(request, 'bolt11', 3_000))

    const updated = await repo.getById('request-1')
    expect(updated?.fulfilledBy).toBe('ecash')
    expect(updated?.paymentMethods.find((method) => method.type === 'ecash')?.status).toBe('received')
    expect(updated?.paymentMethods.find((method) => method.type === 'bolt11')?.status).toBe('received')
  })
})
