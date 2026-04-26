import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  createCashuBackendMock,
  backendRecoverPendingQuotesMock,
  pendingOpRepoInstance,
  txRepoInstance,
  offlineTokenStoreInstance,
  PendingOperationRepositoryMock,
  TransactionRepositoryMock,
  OfflineTokenStoreMock,
} = vi.hoisted(() => ({
  createCashuBackendMock: vi.fn(),
  backendRecoverPendingQuotesMock: vi.fn(),
  pendingOpRepoInstance: { kind: 'pending-op-repo' },
  txRepoInstance: { kind: 'tx-repo' },
  offlineTokenStoreInstance: { kind: 'offline-token-store' },
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
  OfflineTokenStoreMock: class {
    constructor() {
      return offlineTokenStoreInstance
    }
  },
}))

vi.mock('@/modules/cashu/create-cashu-backend', () => ({
  createCashuBackend: createCashuBackendMock,
}))

vi.mock('@/adapters/storage/dexie/dexie-pending-operation.repository', () => ({
  DexiePendingOperationRepository: PendingOperationRepositoryMock,
}))

vi.mock('@/adapters/storage/dexie/dexie-transaction.repository', () => ({
  DexieTransactionRepository: TransactionRepositoryMock,
}))

vi.mock('@/adapters/storage/dexie/dexie-offline-token-store', () => ({
  DexieOfflineTokenStore: OfflineTokenStoreMock,
}))

import { recoverPendingQuotes } from '@/composition/recover-pending-quotes'

describe('recoverPendingQuotes composition helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    backendRecoverPendingQuotesMock.mockResolvedValue({ recovered: 1, failed: 0, expired: 2 })
    createCashuBackendMock.mockReturnValue({
      recoverPendingQuotes: backendRecoverPendingQuotesMock,
    })
  })

  it('forwards activeMintUrls through the public Cashu backend factory', async () => {
    const result = await recoverPendingQuotes(['https://mint.a', 'https://mint.b'])

    expect(result).toEqual({ recovered: 1, failed: 0, expired: 2 })
    expect(createCashuBackendMock).toHaveBeenCalledWith({
      pendingOpRepo: pendingOpRepoInstance,
      txRepo: txRepoInstance,
      offlineTokenStore: offlineTokenStoreInstance,
      getActiveMintUrls: expect.any(Function),
    })
    const deps = createCashuBackendMock.mock.calls[0][0]
    expect(deps.getActiveMintUrls()).toEqual(['https://mint.a', 'https://mint.b'])
    expect(backendRecoverPendingQuotesMock).toHaveBeenCalled()
  })
})
