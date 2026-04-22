import { describe, expect, it, vi } from 'vitest'

import { sat } from '@/core/domain/amount'
import { removeMintArtifacts } from '@/composition/remove-mint'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'

function createTxRepoMock(): TransactionRepository {
  return {
    save: vi.fn(),
    getById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    findAll: vi.fn(),
    deleteAll: vi.fn(),
    deleteOlderThan: vi.fn(),
  }
}

describe('removeMintArtifacts', () => {
  it('fails only pending transactions for the deleted mint and preserves metadata', async () => {
    const txRepo = createTxRepoMock()
    const removeMintFromSdk = vi.fn().mockResolvedValue(undefined)
    const clearLocalMintData = vi.fn().mockResolvedValue(undefined)

    vi.mocked(txRepo.findAll).mockResolvedValue([
      {
        id: 'tx-pending-match',
        direction: 'receive',
        method: 'cashu:lightning',
        protocol: 'bolt11',
        amount: sat(100),
        accountId: 'https://mint.a/',
        status: 'pending',
        createdAt: 1,
        metadata: { quoteId: 'quote-1' },
      },
      {
        id: 'tx-pending-other',
        direction: 'receive',
        method: 'cashu:lightning',
        protocol: 'bolt11',
        amount: sat(200),
        accountId: 'https://mint.b',
        status: 'pending',
        createdAt: 2,
      },
      {
        id: 'tx-settled-match',
        direction: 'receive',
        method: 'cashu:lightning',
        protocol: 'bolt11',
        amount: sat(300),
        accountId: 'https://mint.a',
        status: 'settled',
        createdAt: 3,
        completedAt: 4,
      },
    ])

    await removeMintArtifacts(
      {
        txRepo,
        removeMintFromSdk,
        clearLocalMintData,
        now: () => 12345,
      },
      'https://mint.a',
    )

    expect(txRepo.update).toHaveBeenCalledTimes(1)
    expect(txRepo.update).toHaveBeenCalledWith('tx-pending-match', {
      status: 'failed',
      completedAt: 12345,
      metadata: {
        quoteId: 'quote-1',
        mintRemoved: true,
      },
    })
    expect(removeMintFromSdk).toHaveBeenCalledWith('https://mint.a')
    expect(clearLocalMintData).toHaveBeenCalledWith('https://mint.a')
  })
})
