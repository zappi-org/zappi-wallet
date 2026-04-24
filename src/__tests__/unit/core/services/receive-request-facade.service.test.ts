import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ReceiveRequestFacadeService } from '@/core/services/receive-request-facade.service'
import type { ReceiveRequestRepository } from '@/core/ports/driven/receive-request.repository.port'
import { sat } from '@/core/domain/amount'
import { createReceiveMethod, createReceiveRequest } from '@/core/domain/receive-request'

describe('ReceiveRequestFacadeService', () => {
  let repo: ReceiveRequestRepository
  let service: ReceiveRequestFacadeService

  beforeEach(() => {
    repo = {
      save: vi.fn().mockResolvedValue(undefined),
      update: vi.fn(),
      updateByPaymentRef: vi.fn(),
      getById: vi.fn(),
      findByPaymentRef: vi.fn(),
      listAll: vi.fn(),
      listPending: vi.fn().mockResolvedValue([]),
      cleanupExpired: vi.fn().mockResolvedValue(0),
    }
    service = new ReceiveRequestFacadeService(repo)
  })

  it('creates bolt11 and ecash methods as active canonical methods', async () => {
    await service.create({
      requestId: 'request-1',
      accountId: 'https://mint.test',
      amount: sat(1000),
      quoteId: 'quote-1',
      bolt11: 'lnbc...',
      ecashRequest: 'creq...',
      ecashRequestId: 'ecash-1',
      expiresAt: 10_000,
    })

    expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      id: 'request-1',
      fulfillmentStatus: 'pending',
      paymentMethods: [
        expect.objectContaining({ type: 'bolt11', status: 'active', ref: 'quote-1' }),
        expect.objectContaining({ type: 'ecash', status: 'active', ref: 'ecash-1' }),
      ],
    }))
  })

  it('settles by payment ref using normalized legacy event method names', async () => {
    const request = createReceiveRequest({
      id: 'request-1',
      amount: sat(1000),
      accountId: 'https://mint.test',
      createdAt: 1_000,
      expiresAt: 10_000,
      paymentMethods: [
        createReceiveMethod({ type: 'bolt11', ref: 'quote-1', encoded: 'lnbc...', expiresAt: 10_000 }),
        createReceiveMethod({ type: 'ecash', ref: 'ecash-1', encoded: 'creq...', expiresAt: 10_000 }),
      ],
    })
    vi.mocked(repo.updateByPaymentRef).mockImplementation(async (_ref, updater) => updater(request))

    const settled = await service.settleByPaymentRef('quote-1', 'lightning')

    expect(repo.updateByPaymentRef).toHaveBeenCalledWith('quote-1', expect.any(Function))
    expect(settled?.fulfillmentStatus).toBe('fulfilled')
    expect(settled?.fulfilledBy).toBe('bolt11')
  })
})
