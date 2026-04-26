import { describe, expect, it, vi } from 'vitest'
import { IncomingPaymentService } from '@/core/services/incoming-payment.service'
import { sat } from '@/core/domain/amount'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { FailedIncomingStore } from '@/core/ports/driven/failed-incoming-store.port'
import type { ReceiveRequestUseCase } from '@/core/ports/driving/receive-request.usecase'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'

function createDeps() {
  const payment = {
    redeem: vi.fn().mockResolvedValue({
      ok: true,
      value: {
        requestId: 'redeem-1',
        amount: sat(100),
        fee: sat(1),
        method: 'ecash',
        protocol: 'cashu',
        completed: true,
        accountId: 'https://mint.test',
      },
    }),
  } as unknown as PaymentUseCase
  const processedStore: ProcessedStore = {
    save: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    existsByTxId: vi.fn().mockResolvedValue(false),
    findById: vi.fn().mockResolvedValue(null),
    findByTxId: vi.fn().mockResolvedValue(null),
  }
  const failedIncomingStore: FailedIncomingStore = {
    save: vi.fn().mockResolvedValue(undefined),
    getRetryable: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue([]),
    markAsNonRetryable: vi.fn().mockResolvedValue(undefined),
    cleanupNonRetryable: vi.fn().mockResolvedValue(undefined),
  }
  const receiveRequest = {
    settleByPaymentRef: vi.fn().mockResolvedValue(null),
  } as unknown as Pick<ReceiveRequestUseCase, 'settleByPaymentRef'>
  const txRepo: TransactionRepository = {
    save: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue([]),
    deleteAll: vi.fn().mockResolvedValue(undefined),
    deleteOlderThan: vi.fn().mockResolvedValue(undefined),
  }

  return { payment, processedStore, failedIncomingStore, receiveRequest, txRepo }
}

describe('IncomingPaymentService', () => {
  it('settles linked receive request before marking an incoming payment processed', async () => {
    const { payment, processedStore, failedIncomingStore, receiveRequest } = createDeps()
    const service = new IncomingPaymentService(payment, processedStore, failedIncomingStore, receiveRequest)

    await service.processIncoming({
      payload: 'cashuA...',
      externalId: 'event-1',
      receiveRequestPaymentRef: 'request-1',
      receiveRequestMethod: 'ecash',
    })

    expect(receiveRequest.settleByPaymentRef).toHaveBeenCalledWith('request-1', 'ecash')
    expect(processedStore.save).toHaveBeenCalledWith(expect.objectContaining({
      externalId: 'event-1',
      result: 'success',
    }))
    expect(vi.mocked(receiveRequest.settleByPaymentRef).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(processedStore.save).mock.invocationCallOrder[0],
    )
  })

  it('does not mark processed when post-redeem receive request settlement fails', async () => {
    const { payment, processedStore, failedIncomingStore, receiveRequest } = createDeps()
    vi.mocked(receiveRequest.settleByPaymentRef).mockRejectedValue(new Error('write failed'))
    const service = new IncomingPaymentService(payment, processedStore, failedIncomingStore, receiveRequest)

    const result = await service.processIncoming({
      payload: 'cashuA...',
      externalId: 'event-1',
      receiveRequestPaymentRef: 'request-1',
      receiveRequestMethod: 'ecash',
    })

    expect(result.status).toBe('failed')
    expect(vi.mocked(processedStore.save)).not.toHaveBeenCalled()
    expect(failedIncomingStore.save).toHaveBeenCalledWith(expect.objectContaining({
      externalId: 'event-1',
      errorCode: 'RECEIVE_REQUEST_SETTLEMENT_FAILED',
      isRetryable: true,
      redeemSucceeded: true,
      receiveRequestPaymentRef: 'request-1',
      receiveRequestMethod: 'ecash',
    }))
  })

  it('repairs receive request lifecycle before marking an already-spent retry skipped', async () => {
    const { payment, processedStore, failedIncomingStore, receiveRequest } = createDeps()
    vi.mocked(payment.redeem).mockResolvedValue({
      ok: false,
      error: { message: 'Token already spent' },
    } as Awaited<ReturnType<PaymentUseCase['redeem']>>)
    const service = new IncomingPaymentService(payment, processedStore, failedIncomingStore, receiveRequest)

    const result = await service.processIncoming({
      payload: 'cashuA...',
      externalId: 'event-1',
      receiveRequestPaymentRef: 'request-1',
      receiveRequestMethod: 'ecash',
    })

    expect(result.status).toBe('already_processed')
    expect(receiveRequest.settleByPaymentRef).toHaveBeenCalledWith('request-1', 'ecash')
    expect(processedStore.save).toHaveBeenCalledWith(expect.objectContaining({
      externalId: 'event-1',
      result: 'skipped',
    }))
  })

  it("marks tx intent='request-fulfill' when paymentRef matches one of my receive requests", async () => {
    const { payment, processedStore, failedIncomingStore, receiveRequest, txRepo } = createDeps()
    vi.mocked(receiveRequest.settleByPaymentRef).mockResolvedValue({
      id: 'rr-1',
      accountId: 'https://mint.test',
      amount: 100,
      fulfillmentStatus: 'fulfilled',
      createdAt: Date.now(),
    })
    const service = new IncomingPaymentService(payment, processedStore, failedIncomingStore, receiveRequest, txRepo)

    await service.processIncoming({
      payload: 'cashuA...',
      externalId: 'event-1',
      receiveRequestPaymentRef: 'my-request-id',
      receiveRequestMethod: 'ecash',
    })

    expect(txRepo.update).toHaveBeenCalledWith('tx-in-event-1', { intent: 'request-fulfill' })
  })

  it('does NOT mark intent when paymentRef has no matching receive request (spoofed/unknown id)', async () => {
    const { payment, processedStore, failedIncomingStore, receiveRequest, txRepo } = createDeps()
    vi.mocked(receiveRequest.settleByPaymentRef).mockResolvedValue(null)
    const service = new IncomingPaymentService(payment, processedStore, failedIncomingStore, receiveRequest, txRepo)

    await service.processIncoming({
      payload: 'cashuA...',
      externalId: 'event-1',
      receiveRequestPaymentRef: 'unknown-id',
      receiveRequestMethod: 'ecash',
    })

    expect(txRepo.update).not.toHaveBeenCalled()
  })

  it('does NOT mark intent when no paymentRef is provided (direct DM / direct paste)', async () => {
    const { payment, processedStore, failedIncomingStore, receiveRequest, txRepo } = createDeps()
    const service = new IncomingPaymentService(payment, processedStore, failedIncomingStore, receiveRequest, txRepo)

    await service.processIncoming({
      payload: 'cashuA...',
      externalId: 'event-1',
    })

    expect(txRepo.update).not.toHaveBeenCalled()
  })
})
