import { describe, expect, it, vi } from 'vitest'

import { sat } from '@/core/domain/amount'
import { recoverPendingQuotes } from './cashu-recovery'
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

  it('treats an explicit empty active mint list as authoritative', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn(),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-empty-active-list',
        kind: 'mint-quote',
        accountId: 'https://inactive.mint/',
        amount: sat(100),
        createdAt: Date.now(),
        metadata: { quoteId: 'quote-empty' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: [],
    })

    expect(result).toEqual({ recovered: 0, failed: 1, expired: 0 })
    expect(txRepo.update).toHaveBeenCalledWith('tx-empty-active-list', {
      status: 'failed',
      completedAt: expect.any(Number),
    })
    expect(quoteOps.checkMintQuote).not.toHaveBeenCalled()
  })

  it('expires quotes from their real expiresAt without checking the mint', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn(),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-expired',
        kind: 'mint-quote',
        accountId: 'https://active.mint',
        amount: sat(150),
        createdAt: Date.now(),
        expiresAt: Date.now() - 1_000,
        metadata: { quoteId: 'quote-expired' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: ['https://active.mint'],
    })

    expect(result).toEqual({ recovered: 0, failed: 0, expired: 1 })
    expect(txRepo.update).toHaveBeenCalledWith('tx-expired', {
      status: 'failed',
      completedAt: expect.any(Number),
    })
    expect(quoteOps.checkMintQuote).not.toHaveBeenCalled()
  })

  it('prefers expiresAt over the legacy createdAt fallback when both exist', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn().mockResolvedValue({ state: 'ISSUED' }),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-expiry-precedence',
        kind: 'mint-quote',
        accountId: 'https://active.mint',
        amount: sat(175),
        createdAt: Date.now() - (25 * 60 * 60 * 1000),
        expiresAt: Date.now() + (5 * 60 * 1000),
        metadata: { quoteId: 'quote-precedence' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: ['https://active.mint'],
    })

    expect(result).toEqual({ recovered: 1, failed: 0, expired: 0 })
    expect(quoteOps.checkMintQuote).toHaveBeenCalledWith('quote-precedence', 'https://active.mint')
    expect(txRepo.update).toHaveBeenCalledWith('tx-expiry-precedence', {
      status: 'settled',
      outcome: 'claimed',
      completedAt: expect.any(Number),
    })
  })

  it('falls back to the legacy 24h age check when expiresAt is missing', async () => {
    const pendingOpRepo = createPendingOpRepoMock()
    const txRepo = createTxRepoMock()
    const quoteOps = {
      checkMintQuote: vi.fn(),
      mintAndReceive: vi.fn(),
    }

    vi.mocked(pendingOpRepo.list).mockResolvedValue([
      {
        id: 'tx-legacy-expired',
        kind: 'mint-quote',
        accountId: 'https://active.mint',
        amount: sat(150),
        createdAt: Date.now() - (25 * 60 * 60 * 1000),
        metadata: { quoteId: 'quote-legacy' },
      },
    ])

    const result = await recoverPendingQuotes({
      pendingOpRepo,
      txRepo,
      quoteOps,
      activeMintUrls: ['https://active.mint'],
    })

    expect(result).toEqual({ recovered: 0, failed: 0, expired: 1 })
    expect(txRepo.update).toHaveBeenCalledWith('tx-legacy-expired', {
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
