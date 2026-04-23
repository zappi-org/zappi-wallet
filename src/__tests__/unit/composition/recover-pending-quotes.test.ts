import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  recoverPendingQuotesMock,
  getQuoteRecoveryOpsMock,
  pendingOpRepoInstance,
  txRepoInstance,
  quoteOpsInstance,
  PendingOperationRepositoryMock,
  TransactionRepositoryMock,
} = vi.hoisted(() => ({
  recoverPendingQuotesMock: vi.fn(),
  getQuoteRecoveryOpsMock: vi.fn(),
  pendingOpRepoInstance: { kind: 'pending-op-repo' },
  txRepoInstance: { kind: 'tx-repo' },
  quoteOpsInstance: { checkMintQuote: vi.fn(), mintAndReceive: vi.fn() },
  PendingOperationRepositoryMock: class {
    constructor() {
      return pendingOpRepoInstance
    }
  },
  TransactionRepositoryMock: class {
    constructor() {
      return txRepoInstance
    }
  },
}))

vi.mock('@/modules/cashu/internal/cashu-recovery', () => ({
  recoverPendingQuotes: recoverPendingQuotesMock,
}))

vi.mock('@/modules/cashu/internal/cashu-backend', () => ({
  getQuoteRecoveryOps: getQuoteRecoveryOpsMock,
}))

vi.mock('@/adapters/storage/dexie/dexie-pending-operation.repository', () => ({
  DexiePendingOperationRepository: PendingOperationRepositoryMock,
}))

vi.mock('@/adapters/storage/dexie/dexie-transaction.repository', () => ({
  DexieTransactionRepository: TransactionRepositoryMock,
}))

import { recoverPendingQuotes } from '@/composition/recover-pending-quotes'

describe('recoverPendingQuotes composition helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    recoverPendingQuotesMock.mockResolvedValue({ recovered: 1, failed: 0, expired: 2 })
    getQuoteRecoveryOpsMock.mockResolvedValue(quoteOpsInstance)
  })

  it('forwards activeMintUrls into cashu quote recovery', async () => {
    const result = await recoverPendingQuotes(['https://mint.a', 'https://mint.b'])

    expect(result).toEqual({ recovered: 1, failed: 0, expired: 2 })
    expect(recoverPendingQuotesMock).toHaveBeenCalledWith({
      pendingOpRepo: pendingOpRepoInstance,
      txRepo: txRepoInstance,
      quoteOps: quoteOpsInstance,
      activeMintUrls: ['https://mint.a', 'https://mint.b'],
    })
  })
})
