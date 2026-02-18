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
const mockCreateMintQuote = vi.fn()
const mockCheckMintQuote = vi.fn()
const mockRedeemMintQuote = vi.fn()
const mockReceiveToken = vi.fn()
const mockEncodeToken = vi.fn()

vi.mock('@/services/cashu/cashu.service', () => {
  class MockCashuService {
    createMintQuote = mockCreateMintQuote
    checkMintQuote = mockCheckMintQuote
    redeemMintQuote = mockRedeemMintQuote
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

vi.mock('@/data/repositories/transaction.repository', () => {
  class MockTransactionRepository {
    create = mockCreateTransaction
    update = mockUpdateTransaction
    findById = mockFindById
    save = vi.fn()
  }
  return {
    TransactionRepository: MockTransactionRepository,
  }
})

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

// Mock Coco cashu service - use vi.hoisted to avoid hoisting issues
const {
  mockCocoCreateMintQuote,
  mockCocoRedeemMintQuote,
  mockCocoReceiveToken,
  mockCocoGetBalances,
  mockCocoCreateMeltQuote,
  mockCocoPayMeltQuote,
} = vi.hoisted(() => ({
  mockCocoCreateMintQuote: vi.fn(),
  mockCocoRedeemMintQuote: vi.fn(),
  mockCocoReceiveToken: vi.fn(),
  mockCocoGetBalances: vi.fn(),
  mockCocoCreateMeltQuote: vi.fn(),
  mockCocoPayMeltQuote: vi.fn(),
}))

vi.mock('@/coco/cashuService', () => ({
  createMintQuote: mockCocoCreateMintQuote,
  redeemMintQuote: mockCocoRedeemMintQuote,
  receiveToken: mockCocoReceiveToken,
  getBalances: mockCocoGetBalances,
  createMeltQuote: mockCocoCreateMeltQuote,
  payMeltQuote: mockCocoPayMeltQuote,
}))

describe('PaymentService', () => {
  let service: PaymentService
  const testMintUrl = 'https://mint.example.com'

  beforeEach(async () => {
    await resetDatabase()
    clearWalletCache()
    vi.clearAllMocks()

    // Default mock implementations
    mockCreateMintQuote.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: {
        quoteId: 'quote-123',
        mintUrl: testMintUrl,
        amount: 1000,
        request: 'lnbc1000n1mock...',
        state: 'UNPAID',
        expiry: Math.floor(Date.now() / 1000) + 3600,
      },
    })

    mockCheckMintQuote.mockResolvedValue('PAID')

    mockRedeemMintQuote.mockResolvedValue({
      isOk: () => true,
      isErr: () => false,
      value: [
        { id: 'k1', amount: 512, secret: 's1', C: 'c1' },
        { id: 'k1', amount: 256, secret: 's2', C: 'c2' },
        { id: 'k1', amount: 128, secret: 's3', C: 'c3' },
        { id: 'k1', amount: 64, secret: 's4', C: 'c4' },
        { id: 'k1', amount: 32, secret: 's5', C: 'c5' },
        { id: 'k1', amount: 8, secret: 's6', C: 'c6' },
      ],
    })

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
      mockCreateMintQuote.mockResolvedValue({
        isOk: () => false,
        isErr: () => true,
        error: { code: 'NO_MINT' },
      })

      const result = await service.createLightningInvoice(1000)

      expect(result.isErr()).toBe(true)
    })
  })

  describe('pollForPayment', () => {
    it('should return true when payment is received', async () => {
      mockCheckMintQuote.mockResolvedValue('PAID')

      const isPaid = await service.checkPaymentStatus(testMintUrl, 'quote-123')

      expect(isPaid).toBe(true)
    })

    it('should return false when payment is not yet received', async () => {
      mockCheckMintQuote.mockResolvedValue('UNPAID')

      const isPaid = await service.checkPaymentStatus(testMintUrl, 'quote-123')

      expect(isPaid).toBe(false)
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

  describe('createPaymentRequest', () => {
    it('should create a NUT-18 payment request', async () => {
      const result = await service.createPaymentRequest(1000, testMintUrl, 'p2pk-pubkey')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.amount).toBe(1000)
        expect(result.value.mints).toContain(testMintUrl)
        expect(result.value.p2pkPubkey).toBe('p2pk-pubkey')
        expect(result.value.encoded).toMatch(/^creq/)
      }
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
})
