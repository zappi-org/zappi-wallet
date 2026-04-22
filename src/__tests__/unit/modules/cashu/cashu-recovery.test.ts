import { describe, expect, it, vi } from 'vitest'

import { sat } from '@/core/domain/amount'
import { recoverPendingQuotes } from '@/modules/cashu/internal/cashu-recovery'
import type { PendingOperationRepository } from '@/core/ports/driven/pending-operation.repository.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'

function createPendingOpRepoMock(): PendingOperationRepository {
  return {
    list: vi.fn(),
    listByAccount: vi.fn(),
    delete: vi.fn(),
    deleteExpired: vi.fn(),
    count: vi.fn(),
  }
}

function createTxRepoMock(): TransactionRepository {
  return {
    save: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    findAll: vi.fn(),
    delete: vi.fn(),
    deleteAll: vi.fn(),
    deleteOlderThan: vi.fn(),
  }
}

describe('recoverPendingQuotes', () => {
  it('fails inactive mint quotes without checking the mint', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn(),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-1',
        kind: 'mint-quote',
        accountId: 'https://inactive.mint/',
        amount: sat(100),
        createdAt: Date.now(),
        metadata: { quoteId: 'quote-1' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: ['https://active.mint'],
    })

    expect(result).toEqual({ recovered: 0, failed: 1, expired: 0 })
    expect(txRepo.update).toHaveBeenCalledWith('tx-1', {
      status: 'failed',
      completedAt: expect.any(Number),
    })
    expect(quoteOps.checkMintQuote).not.toHaveBeenCalled()
  })

  it('continues normal recovery for active mint quotes', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn().mockResolvedValue({ state: 'ISSUED' }),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-2',
        kind: 'mint-quote',
        accountId: 'https://active.mint/',
        amount: sat(200),
        createdAt: Date.now(),
        metadata: { quoteId: 'quote-2' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: ['https://active.mint'],
    })

    expect(result).toEqual({ recovered: 1, failed: 0, expired: 0 })
    expect(quoteOps.checkMintQuote).toHaveBeenCalledWith('quote-2', 'https://active.mint/')
    expect(txRepo.update).toHaveBeenCalledWith('tx-2', {
      status: 'settled',
      outcome: 'claimed',
      completedAt: expect.any(Number),
    })
  })
})
