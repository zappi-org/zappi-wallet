import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getQuoteRecoveryOpsMock,
  receiveTokenMock,
  estimateReceiveFeeMock,
  checkProofStatesMock,
  recoverPendingQuotesMock,
  quoteOpsInstance,
} = vi.hoisted(() => ({
  getQuoteRecoveryOpsMock: vi.fn(),
  receiveTokenMock: vi.fn(),
  estimateReceiveFeeMock: vi.fn(),
  checkProofStatesMock: vi.fn(),
  recoverPendingQuotesMock: vi.fn(),
  quoteOpsInstance: { checkMintQuote: vi.fn(), mintAndReceive: vi.fn() },
}))

vi.mock('./cashu-backend', () => ({
  prepareMelt: vi.fn(),
  executeMelt: vi.fn(),
  rollbackMelt: vi.fn(),
  checkMelt: vi.fn(),
  createMintQuote: vi.fn(),
  redeemMintQuote: vi.fn(),
  checkMintQuote: vi.fn(),
  getMeltRecoveryOps: vi.fn(),
  prepareSend: vi.fn(),
  executeSend: vi.fn(),
  rollbackSend: vi.fn(),
  finalizeSend: vi.fn(),
  getSendOperationState: vi.fn(),
  checkProofStates: checkProofStatesMock,
  receiveToken: receiveTokenMock,
  estimateReceiveFee: estimateReceiveFeeMock,
  getSendRecoveryOps: vi.fn(),
  onMintQuotePaid: vi.fn(),
  getQuoteRecoveryOps: getQuoteRecoveryOpsMock,
  parsePaymentRequest: vi.fn(),
  preparePaymentRequest: vi.fn(),
  executePaymentRequest: vi.fn(),
  getBalances: vi.fn(),
  restoreWallet: vi.fn(),
  inspectInput: vi.fn(),
}))

vi.mock('./cashu-recovery', () => ({
  recoverPendingMelts: vi.fn(),
  recoverPendingSendTokens: vi.fn(),
  recoverPendingQuotes: recoverPendingQuotesMock,
}))

vi.mock('./coco-sdk', () => ({
  getMintQuote: vi.fn(),
  abandonMintQuote: vi.fn(),
}))

vi.mock('./offline-token-recovery', () => ({
  redeemPendingReceivedTokens: vi.fn(),
  storeOfflineToken: vi.fn(),
}))

import { createCashuBackend } from '../create-cashu-backend'

describe('createCashuBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getQuoteRecoveryOpsMock.mockResolvedValue(quoteOpsInstance)
    receiveTokenMock.mockResolvedValue({ amount: 1, fee: 0, unit: 'sat', mintUrl: 'https://mint-a.test' })
    estimateReceiveFeeMock.mockResolvedValue({ grossAmount: 1, fee: 0, netAmount: 1, unit: 'sat', mintUrl: 'https://mint-a.test' })
    recoverPendingQuotesMock.mockResolvedValue({ recovered: 0, failed: 0, expired: 0 })
  })

  it('passes undefined activeMintUrls through when no authoritative mint list is available', async () => {
    const deps = {
      pendingOpRepo: { list: vi.fn(), listByAccount: vi.fn(), delete: vi.fn(), deleteExpired: vi.fn(), count: vi.fn() },
      txRepo: { save: vi.fn(), getById: vi.fn(), list: vi.fn(), update: vi.fn(), findAll: vi.fn(), delete: vi.fn(), deleteAll: vi.fn(), deleteOlderThan: vi.fn() },
      offlineTokenStore: { getAll: vi.fn(), put: vi.fn(), bulkDelete: vi.fn() },
    }
    const backend = createCashuBackend(deps)

    await backend.recoverPendingQuotes()

    expect(recoverPendingQuotesMock).toHaveBeenCalledWith({
      pendingOpRepo: deps.pendingOpRepo,
      txRepo: deps.txRepo,
      quoteOps: quoteOpsInstance,
      activeMintUrls: undefined,
    })
  })

  it('preserves an explicit empty active mint list as authoritative', async () => {
    const deps = {
      pendingOpRepo: { list: vi.fn(), listByAccount: vi.fn(), delete: vi.fn(), deleteExpired: vi.fn(), count: vi.fn() },
      txRepo: { save: vi.fn(), getById: vi.fn(), list: vi.fn(), update: vi.fn(), findAll: vi.fn(), delete: vi.fn(), deleteAll: vi.fn(), deleteOlderThan: vi.fn() },
      offlineTokenStore: { getAll: vi.fn(), put: vi.fn(), bulkDelete: vi.fn() },
      getActiveMintUrls: () => [],
    }
    const backend = createCashuBackend(deps)

    await backend.recoverPendingQuotes()

    expect(recoverPendingQuotesMock).toHaveBeenCalledWith({
      pendingOpRepo: deps.pendingOpRepo,
      txRepo: deps.txRepo,
      quoteOps: quoteOpsInstance,
      activeMintUrls: [],
    })
  })

  it('passes active mint trust scope to receive operations', async () => {
    const deps = {
      pendingOpRepo: { list: vi.fn(), listByAccount: vi.fn(), delete: vi.fn(), deleteExpired: vi.fn(), count: vi.fn() },
      txRepo: { save: vi.fn(), getById: vi.fn(), list: vi.fn(), update: vi.fn(), findAll: vi.fn(), delete: vi.fn(), deleteAll: vi.fn(), deleteOlderThan: vi.fn() },
      offlineTokenStore: { getAll: vi.fn(), put: vi.fn(), bulkDelete: vi.fn() },
      getActiveMintUrls: () => ['https://mint-a.test'],
    }
    const backend = createCashuBackend(deps)

    await backend.receiveToken('cashuA...')
    await backend.estimateReceiveFee('cashuA...')

    expect(receiveTokenMock).toHaveBeenCalledWith('cashuA...', expect.objectContaining({ trustedMintUrls: ['https://mint-a.test'] }))
    expect(estimateReceiveFeeMock).toHaveBeenCalledWith('cashuA...', expect.objectContaining({ trustedMintUrls: ['https://mint-a.test'] }))
  })
})
