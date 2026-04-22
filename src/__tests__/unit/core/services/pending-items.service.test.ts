import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PendingItemsService, type PendingItemsDataSource } from '@/core/services/pending-items.service'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { ReceiveRequestRepository } from '@/core/ports/driven/receive-request.repository.port'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import { sat } from '@/core/domain/amount'

function createDataSource(): PendingItemsDataSource {
  return {
    getPendingReceivedTokens: vi.fn().mockResolvedValue([]),
    getPendingReceiveRequests: vi.fn().mockResolvedValue([]),
    getPendingSendTokens: vi.fn().mockResolvedValue([]),
    getActivePendingQuotes: vi.fn().mockResolvedValue([]),
  }
}

describe('PendingItemsService', () => {
  let dataSource: PendingItemsDataSource
  let txRepo: TransactionRepository
  let receiveRequestRepo: ReceiveRequestRepository
  let adapter: PaymentMethodAdapter
  let service: PendingItemsService

  beforeEach(() => {
    dataSource = createDataSource()
    txRepo = {
      save: vi.fn(),
      getById: vi.fn().mockResolvedValue(null),
      list: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      findAll: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteAll: vi.fn(),
      deleteOlderThan: vi.fn(),
    }
    receiveRequestRepo = {
      save: vi.fn().mockResolvedValue(undefined),
      getById: vi.fn().mockResolvedValue(null),
      findByPaymentRef: vi.fn().mockResolvedValue(null),
      listPending: vi.fn().mockResolvedValue([]),
      cleanupExpired: vi.fn().mockResolvedValue(0),
    }
    adapter = {
      id: 'cashu:bolt11',
      moduleId: 'cashu',
      protocol: 'bolt11',
      supportedUnits: ['sat'],
      capabilities: {
        canSend: true,
        canReceive: true,
        canEstimateFee: true,
      },
      estimateFee: vi.fn(),
      prepareSend: vi.fn(),
      executeSend: vi.fn(),
      cancelPrepared: vi.fn(),
      reclaimFailed: vi.fn(),
      createReceiveRequest: vi.fn(),
      recoverPending: vi.fn(),
      checkAlive: vi.fn().mockResolvedValue(true),
    }

    service = new PendingItemsService(
      dataSource,
      txRepo,
      receiveRequestRepo,
      () => [adapter],
    )
  })

  it('marks receive requests expired and deletes all linked transaction ids', async () => {
    vi.mocked(receiveRequestRepo.getById).mockResolvedValue({
      id: 'receive-request-1',
      amount: sat(1000),
      accountId: 'https://mint.test',
      status: 'pending',
      paymentMethods: [
        { type: 'lightning', ref: 'quote-1', encoded: 'lnbc...', expiresAt: 2_000 },
        { type: 'ecash', ref: 'ecash-1', encoded: 'creq...', expiresAt: 2_000 },
      ],
      createdAt: 1_000,
      expiresAt: 2_000,
    })

    await service.expireById('receive-request-1')

    expect(receiveRequestRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'receive-request-1',
      status: 'expired',
    }))
    expect(txRepo.delete).toHaveBeenCalledWith('receive-request-1')
    expect(txRepo.delete).toHaveBeenCalledWith('quote-1')
    expect(txRepo.delete).toHaveBeenCalledWith('ecash-1')
  })

  it('returns expired when the linked quote is no longer alive', async () => {
    vi.mocked(receiveRequestRepo.getById).mockResolvedValue({
      id: 'receive-request-1',
      amount: sat(1000),
      accountId: 'https://mint.test',
      status: 'pending',
      paymentMethods: [
        { type: 'lightning', ref: 'quote-1', encoded: 'lnbc...', expiresAt: Date.now() + 60_000 },
      ],
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    })
    vi.mocked(adapter.checkAlive!).mockResolvedValueOnce(false)

    await expect(service.checkEffectiveExpiry('receive-request-1')).resolves.toBe('expired')
    expect(adapter.checkAlive).toHaveBeenCalledWith({
      requestId: 'quote-1',
      accountId: 'https://mint.test',
    })
  })

  it('treats missing receive requests as expired', async () => {
    await expect(service.checkEffectiveExpiry('missing')).resolves.toBe('expired')
  })
})
