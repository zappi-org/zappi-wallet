import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { PaymentService } from '@/services/payment/payment.service'
import { resetDatabase } from '@/data/database'
import { clearWalletCache } from '@/data/cache'

// Mock cashu-ts
vi.mock('@cashu/cashu-ts', () => {
  class MockCashuMint {
    mintUrl: string
    constructor(mintUrl: string) {
      this.mintUrl = mintUrl
    }
  }
  class MockCashuWallet {
    mint: MockCashuMint
    constructor(mint: MockCashuMint) {
      this.mint = mint
    }
    loadMint = vi.fn().mockResolvedValue(undefined)
  }
  return {
    CashuWallet: MockCashuWallet,
    CashuMint: MockCashuMint,
    getDecodedToken: vi.fn().mockReturnValue({
      mint: 'https://mint.example.com',
      proofs: [{ id: 'k1', amount: 100, secret: 's1', C: 'c1' }],
      unit: 'sat',
    }),
    getEncodedToken: vi.fn().mockReturnValue('cashuBmocktoken...'),
  }
})

// Mock CashuService
const mockCheckMintQuote = vi.fn()
const mockReceiveToken = vi.fn()
const mockEncodeToken = vi.fn()

vi.mock('@/services/cashu/cashu.service', () => {
  class MockCashuService {
    checkMintQuote = mockCheckMintQuote
    receiveToken = mockReceiveToken
    encodeToken = mockEncodeToken
    decodeToken = vi.fn().mockReturnValue({
      mintUrl: 'https://mint.example.com',
      proofs: [{ id: 'k1', amount: 100, secret: 's1', C: 'c1' }],
    })
  }
  return {
    CashuService: MockCashuService,
  }
})

// Mock WalletService
const mockAddProofs = vi.fn()
const mockGetProofsForAmount = vi.fn()
const mockRemoveProofs = vi.fn()
const mockGetMints = vi.fn()

vi.mock('@/services/wallet/wallet.service', () => {
  class MockWalletService {
    addProofs = mockAddProofs
    getProofsForAmount = mockGetProofsForAmount
    removeProofs = mockRemoveProofs
    getMints = mockGetMints
  }
  return {
    WalletService: MockWalletService,
  }
})

// Mock TransactionRepository
const mockCreateTransaction = vi.fn()
const mockUpdateTransaction = vi.fn()
const mockFindById = vi.fn()

vi.mock('@/data/repositories/transaction.repository', () => ({
  TransactionRepository: vi.fn(),
  getTransactionRepo: vi.fn(),
}))

// Wire up mock after hoisting
import { getTransactionRepo } from '@/data/repositories/transaction.repository'
const mockRepoInstance = {
  create: mockCreateTransaction,
  update: mockUpdateTransaction,
  findById: mockFindById,
  save: vi.fn(),
}
vi.mocked(getTransactionRepo).mockReturnValue(mockRepoInstance as unknown as ReturnType<typeof getTransactionRepo>)

// Mock SettingsRepository
vi.mock('@/data/repositories/settings.repository', () => {
  class MockSettingsRepository {
    getSettings = vi.fn().mockResolvedValue({
      mints: ['https://mint1.com', 'https://mint2.com'],
      relays: ['wss://relay1.com'],
    })
  }
  return {
    SettingsRepository: MockSettingsRepository,
  }
})

// Mock Lightning service
vi.mock('@/services/lightning', () => ({
  isBolt11Invoice: vi.fn().mockReturnValue(true),
  decodeInvoice: vi.fn().mockReturnValue({
    amountSats: 100,
    isExpired: false,
    paymentHash: 'hash123',
  }),
  isValidLightningAddress: vi.fn().mockReturnValue(false),
}))

// Mock LNURL service
vi.mock('@/services/lnurl', () => ({
  resolveLightningAddress: vi.fn(),
  fetchLnurlPayInvoice: vi.fn(),
}))

// Mock Coco cashu service - use vi.hoisted to avoid hoisting issues
const {
  mockCocoCreateMintQuote,
  mockCocoRedeemMintQuote,
  mockCocoReceiveToken,
  mockCocoGetBalances,
  mockCocoPrepareMelt,
  mockCocoExecuteMelt,
  mockCocoRollbackMelt,
} = vi.hoisted(() => ({
  mockCocoCreateMintQuote: vi.fn(),
  mockCocoRedeemMintQuote: vi.fn(),
  mockCocoReceiveToken: vi.fn(),
  mockCocoGetBalances: vi.fn(),
  mockCocoPrepareMelt: vi.fn(),
  mockCocoExecuteMelt: vi.fn(),
  mockCocoRollbackMelt: vi.fn(),
}))

vi.mock('@/coco/cashuService', () => ({
  createMintQuote: mockCocoCreateMintQuote,
  redeemMintQuote: mockCocoRedeemMintQuote,
  receiveToken: mockCocoReceiveToken,
  getBalances: mockCocoGetBalances,
  prepareMelt: mockCocoPrepareMelt,
  executeMelt: mockCocoExecuteMelt,
  rollbackMelt: mockCocoRollbackMelt,
}))

describe('PaymentService', () => {
  let service: PaymentService
  const testMintUrl = 'https://mint.example.com'

  beforeEach(async () => {
    await resetDatabase()
    clearWalletCache()
    vi.clearAllMocks()

    // Default mock implementations
    mockCheckMintQuote.mockResolvedValue('PAID')

    mockReceiveToken.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: {
        proofs: [{ id: 'k1', amount: 100, secret: 's1', C: 'c1' }],
        mintUrl: testMintUrl,
      },
    })

    mockAddProofs.mockResolvedValue(undefined)
    mockGetMints.mockResolvedValue([testMintUrl, 'https://mint2.com'])

    mockCreateTransaction.mockResolvedValue('tx-123')
    mockUpdateTransaction.mockResolvedValue(undefined)
    mockFindById.mockResolvedValue(null) // No existing transaction by default

    // Mock Coco cashu service implementations
    mockCocoCreateMintQuote.mockResolvedValue({
      quote: 'quote-123',
      request: 'lnbc1000n1mock...',
      expiry: Math.floor(Date.now() / 1000) + 3600,
    })
    mockCocoRedeemMintQuote.mockResolvedValue([
      { id: 'k1', amount: 512, secret: 's1', C: 'c1' },
      { id: 'k1', amount: 256, secret: 's2', C: 'c2' },
      { id: 'k1', amount: 128, secret: 's3', C: 'c3' },
      { id: 'k1', amount: 64, secret: 's4', C: 'c4' },
      { id: 'k1', amount: 32, secret: 's5', C: 'c5' },
      { id: 'k1', amount: 8, secret: 's6', C: 'c6' },
    ])
    mockCocoReceiveToken.mockResolvedValue({
      proofs: [{ id: 'k1', amount: 100, secret: 's1', C: 'c1' }],
      mintUrl: testMintUrl,
    })
    mockCocoGetBalances.mockResolvedValue({
      [testMintUrl]: 1000,
    })
    mockCocoPrepareMelt.mockResolvedValue({
      operationId: 'op-123',
      quoteId: 'melt-quote-123',
      amount: 100,
      fee_reserve: 2,
      swap_fee: 0,
    })
    mockCocoExecuteMelt.mockResolvedValue({ state: 'finalized' })
    mockCocoRollbackMelt.mockResolvedValue(undefined)

    service = new PaymentService()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  describe('createLightningInvoice', () => {
    it('should create a Lightning invoice for receiving payment', async () => {
      const result = await service.createLightningInvoice(1000, testMintUrl)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.quote.quoteId).toBe('quote-123')
        expect(result.value.quote.request).toContain('lnbc')
        expect(result.value.quote.amount).toBe(1000)
      }
    })

    it('should use first available mint if none specified', async () => {
      const result = await service.createLightningInvoice(1000)

      expect(result.isOk()).toBe(true)
      expect(mockGetMints).toHaveBeenCalled()
    })

    it('should return error if no mints available', async () => {
      mockGetMints.mockResolvedValue([])
      mockCocoCreateMintQuote.mockRejectedValue(new Error('NO_MINT'))

      const result = await service.createLightningInvoice(1000)

      expect(result.isErr()).toBe(true)
    })
  })

  describe('claimPayment', () => {
    it('should claim tokens after payment and store them', async () => {
      const result = await service.claimPayment(testMintUrl, 'quote-123', 100)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        // Coco manages proofs internally, so we get empty array back
        expect(result.value.proofs).toHaveLength(0)
        expect(result.value.amount).toBe(100)
        expect(mockCocoRedeemMintQuote).toHaveBeenCalledWith(testMintUrl, 'quote-123', 100)
      }
    })

    it('should return error if claiming fails', async () => {
      mockCocoRedeemMintQuote.mockRejectedValueOnce(new Error('Quote not found'))

      const result = await service.claimPayment(testMintUrl, 'quote-123', 100)

      expect(result.isErr()).toBe(true)
    })
  })

  describe('receiveEcash', () => {
    it('should receive an ecash token and store proofs', async () => {
      const token = 'cashuBtoken...'

      const result = await service.receiveEcash(token)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.amount).toBe(100)
        // Coco handles storage via cocoReceiveToken
        expect(mockCocoReceiveToken).toHaveBeenCalledWith(token)
      }
    })

    it('should receive P2PK locked token with private key', async () => {
      const token = 'cashuBtoken...'
      const privkey = 'abc123'

      const result = await service.receiveEcash(token, { privkey })

      expect(result.isOk()).toBe(true)
      // P2PK tokens go through cashuService first to unlock
      expect(mockReceiveToken).toHaveBeenCalledWith(token, { privkey })
    })

    it('should return error for invalid token', async () => {
      mockCocoReceiveToken.mockRejectedValueOnce(new Error('Token already spent'))

      const result = await service.receiveEcash('invalid-token')

      expect(result.isErr()).toBe(true)
    })
  })

  describe('getTotalReceived', () => {
    it('should calculate total amount from proofs', () => {
      const proofs = [
        { id: 'k1', amount: 100, secret: 's1', C: 'c1' },
        { id: 'k1', amount: 50, secret: 's2', C: 'c2' },
      ]

      const total = service.getTotalAmount(proofs)

      expect(total).toBe(150)
    })
  })

  describe('mintSwap', () => {
    const fromMint = 'https://mint-a.com'
    const toMint = 'https://mint-b.com'

    beforeEach(() => {
      mockCocoGetBalances.mockResolvedValue({ [fromMint]: 1000 })
      mockCocoPrepareMelt.mockResolvedValue({
        operationId: 'op-swap-1',
        quoteId: 'melt-q-1',
        amount: 100,
        fee_reserve: 2,
        swap_fee: 1,
      })
    })

    it('success: prepareMelt → executeMelt → redeemMintQuote', async () => {
      const result = await service.mintSwap(fromMint, toMint, 100)

      expect(result.isOk()).toBe(true)
      expect(mockCocoCreateMintQuote).toHaveBeenCalledWith(toMint, 100)
      expect(mockCocoPrepareMelt).toHaveBeenCalledWith(fromMint, 'lnbc1000n1mock...')
      expect(mockCocoExecuteMelt).toHaveBeenCalledWith('op-swap-1')
      expect(mockCocoRedeemMintQuote).toHaveBeenCalledWith(toMint, 'quote-123', 100)
      if (result.isOk()) {
        expect(result.value.fee).toBe(3) // fee_reserve + swap_fee
      }
    })

    it('melt 실패 시: rollbackMelt 호출되고 에러 반환', async () => {
      mockCocoExecuteMelt.mockRejectedValueOnce(new Error('Mint error'))

      const result = await service.mintSwap(fromMint, toMint, 100)

      expect(result.isErr()).toBe(true)
      expect(mockCocoRollbackMelt).toHaveBeenCalledWith('op-swap-1', 'melt failed')
    })

    it('rollback도 실패 시: 에러 로그만 남기고 원래 에러 반환', async () => {
      mockCocoExecuteMelt.mockRejectedValueOnce(new Error('Mint error'))
      mockCocoRollbackMelt.mockRejectedValueOnce(new Error('Rollback failed'))
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const result = await service.mintSwap(fromMint, toMint, 100)

      expect(result.isErr()).toBe(true)
      expect(consoleSpy).toHaveBeenCalledWith(
        '[MintSwap] Rollback also failed:',
        expect.any(Error)
      )
      consoleSpy.mockRestore()
    })

    it('drain mode: 잔액 부족 시 rollback 후 재시도', async () => {
      mockCocoGetBalances.mockResolvedValue({ [fromMint]: 100 })
      // First prepare: too expensive
      mockCocoPrepareMelt
        .mockResolvedValueOnce({
          operationId: 'op-1',
          quoteId: 'melt-q-1',
          amount: 100,
          fee_reserve: 5,
          swap_fee: 2,
        })
        // Second prepare: adjusted amount
        .mockResolvedValueOnce({
          operationId: 'op-2',
          quoteId: 'melt-q-2',
          amount: 93,
          fee_reserve: 5,
          swap_fee: 2,
        })
      mockCocoCreateMintQuote
        .mockResolvedValueOnce({ quote: 'q1', request: 'lnbc1...', expiry: 9999 })
        .mockResolvedValueOnce({ quote: 'q2', request: 'lnbc2...', expiry: 9999 })

      const result = await service.mintSwap(fromMint, toMint, 100, { drain: true })

      expect(mockCocoRollbackMelt).toHaveBeenCalledWith('op-1', 'drain: retry with adjusted amount')
      expect(mockCocoExecuteMelt).toHaveBeenCalledWith('op-2')
      expect(result.isOk()).toBe(true)
    })

    it('drain mode: 조정 금액이 0 이하이면 InsufficientBalanceError', async () => {
      mockCocoGetBalances.mockResolvedValue({ [fromMint]: 10 })
      mockCocoPrepareMelt.mockResolvedValueOnce({
        operationId: 'op-1',
        quoteId: 'melt-q-1',
        amount: 10,
        fee_reserve: 8,
        swap_fee: 5,
      })

      const result = await service.mintSwap(fromMint, toMint, 10, { drain: true })

      expect(result.isErr()).toBe(true)
      expect(mockCocoRollbackMelt).toHaveBeenCalledWith('op-1', 'drain: adjusted amount <= 0')
    })
  })

  describe('sendLightning (2-phase melt)', () => {
    beforeEach(() => {
      mockCocoGetBalances.mockResolvedValue({ [testMintUrl]: 1000 })
      mockCocoPrepareMelt.mockResolvedValue({
        operationId: 'op-send-1',
        quoteId: 'melt-send-q-1',
        amount: 100,
        fee_reserve: 2,
        swap_fee: 0,
      })
    })

    it('success: prepareMelt → executeMelt', async () => {
      const result = await service.sendLightning('lnbc100n1mock...', 100, testMintUrl)

      expect(result.isOk()).toBe(true)
      expect(mockCocoPrepareMelt).toHaveBeenCalledWith(testMintUrl, 'lnbc100n1mock...')
      expect(mockCocoExecuteMelt).toHaveBeenCalledWith('op-send-1')
      if (result.isOk()) {
        expect(result.value.paid).toBe(true)
        expect(result.value.fee).toBe(2)
      }
    })

    it('melt 실패 시: rollbackMelt 호출', async () => {
      mockCocoExecuteMelt.mockRejectedValueOnce(new Error('Payment failed'))

      const result = await service.sendLightning('lnbc100n1mock...', 100, testMintUrl)

      // Should fall through to error since all mints failed
      expect(result.isErr()).toBe(true)
      expect(mockCocoRollbackMelt).toHaveBeenCalledWith('op-send-1', 'melt failed')
    })
  })
})
