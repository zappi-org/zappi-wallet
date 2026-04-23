import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getQuoteRecoveryOpsMock,
  recoverPendingQuotesMock,
  quoteOpsInstance,
} = vi.hoisted(() => ({
  getQuoteRecoveryOpsMock: vi.fn(),
  recoverPendingQuotesMock: vi.fn(),
  quoteOpsInstance: { checkMintQuote: vi.fn(), mintAndReceive: vi.fn() },
}))

vi.mock('@/modules/cashu/internal/cashu-backend', () => ({
  prepareMelt: vi.fn(),
  executeMelt: vi.fn(),
  rollbackMelt: vi.fn(),
  createMintQuote: vi.fn(),
  redeemMintQuote: vi.fn(),
  checkMintQuote: vi.fn(),
  getMeltRecoveryOps: vi.fn(),
  prepareSend: vi.fn(),
  executeSend: vi.fn(),
  rollbackSend: vi.fn(),
  finalizeSend: vi.fn(),
  receiveToken: vi.fn(),
  estimateReceiveFee: vi.fn(),
  getSendRecoveryOps: vi.fn(),
  onMintQuotePaid: vi.fn(),
  getQuoteRecoveryOps: getQuoteRecoveryOpsMock,
  parsePaymentRequest: vi.fn(),
  preparePaymentRequest: vi.fn(),
  executePaymentRequest: vi.fn(),
  getBalances: vi.fn(),
  inspectInput: vi.fn(),
}))

vi.mock('@/modules/cashu/internal/cashu-recovery', () => ({
  recoverPendingMelts: vi.fn(),
  recoverPendingSendTokens: vi.fn(),
  recoverPendingQuotes: recoverPendingQuotesMock,
}))

vi.mock('@/modules/cashu/internal/coco-sdk', () => ({
  getMintQuote: vi.fn(),
}))

vi.mock('@/modules/cashu/internal/offline-token-recovery', () => ({
  redeemPendingReceivedTokens: vi.fn(),
  storeOfflineToken: vi.fn(),
}))

import { createCashuBackend } from '@/modules/cashu/create-cashu-backend'

describe('createCashuBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getQuoteRecoveryOpsMock.mockResolvedValue(quoteOpsInstance)
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
})
