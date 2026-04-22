import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock external dependencies (vi.hoisted for factory references) ───

const { mockBackend } = vi.hoisted(() => ({
  mockBackend: {
    getBalances: vi.fn().mockResolvedValue({}),
    prepareMelt: vi.fn(),
    executeMelt: vi.fn(),
    rollbackMelt: vi.fn(),
    createMintQuote: vi.fn(),
    getMintQuote: vi.fn(),
    redeemMintQuote: vi.fn(),
    prepareSend: vi.fn(),
    executeSend: vi.fn(),
    rollbackSend: vi.fn(),
    receiveToken: vi.fn(),
    receiveP2PKToken: vi.fn(),
    recoverPendingMelts: vi.fn(),
    recoverPendingSendTokens: vi.fn(),
    recoverPendingQuotes: vi.fn().mockResolvedValue({ recovered: 0, failed: 0, expired: 0 }),
    parsePaymentRequest: vi.fn(),
    preparePaymentRequest: vi.fn(),
    executePaymentRequest: vi.fn(),
  },
}))

vi.mock('@/modules/cashu/create-cashu-backend', () => ({
  createCashuBackend: () => mockBackend,
}))

vi.mock('@/modules/cashu/cashu.module', () => ({
  CashuModule: class MockCashuModule {
    id = 'cashu'
    displayName = 'Cashu'
    initialize = vi.fn()
    dispose = vi.fn()
    isEnabled = vi.fn().mockReturnValue(false)
    send = vi.fn()
    getPaymentAdapters = vi.fn().mockReturnValue([])
    getCapabilities = vi.fn().mockReturnValue([])
    getBalance = vi.fn().mockResolvedValue({
      moduleId: 'cashu',
      accounts: [],
      total: { value: 0n, unit: 'sat' },
    })
    on = vi.fn().mockReturnValue(() => {})
  },
}))

vi.mock('@/adapters/nostr/nostr-gateway', () => ({
  NostrGatewayAdapter: class MockNostrGateway {
    connect = vi.fn()
    disconnect = vi.fn()
    publish = vi.fn()
    queryEvents = vi.fn().mockResolvedValue([])
    subscribe = vi.fn().mockReturnValue(() => {})
  },
}))

vi.mock('@/adapters/storage/dexie/dexie-transaction.repository', () => ({
  DexieTransactionRepository: class {
    save = vi.fn()
    getById = vi.fn()
    list = vi.fn().mockResolvedValue([])
    update = vi.fn()
  },
}))

vi.mock('@/adapters/storage/dexie/dexie-contact.repository', () => ({
  DexieContactRepository: class {
    save = vi.fn()
    getById = vi.fn()
    list = vi.fn().mockResolvedValue([])
    update = vi.fn()
    delete = vi.fn()
    findByAddress = vi.fn()
  },
}))

vi.mock('@/adapters/storage/dexie/dexie-pending-operation.repository', () => ({
  DexiePendingOperationRepository: class {
    list = vi.fn().mockResolvedValue([])
    listByAccount = vi.fn().mockResolvedValue([])
    delete = vi.fn()
    deleteExpired = vi.fn()
    count = vi.fn().mockResolvedValue(0)
  },
}))

// ─── Import after mocks ───

import { createBootstrap, type BootstrapResult } from '@/composition/bootstrap'

describe('bootstrap', () => {
  let result: BootstrapResult

  beforeEach(() => {
    result = createBootstrap({
      nostrPrivateKeyHex: 'a'.repeat(64),
    })
  })

  it('should return a complete ServiceRegistry', () => {
    expect(result.eventBus).toBeDefined()
    expect(result.eventBus.emit).toBeTypeOf('function')
    expect(result.eventBus.on).toBeTypeOf('function')

    expect(result.payment).toBeDefined()
    expect(result.balance).toBeDefined()
    expect(result.swap).toBeDefined()
    expect(result.contact).toBeDefined()
  })

  it('should expose CashuModule for manual initialization', () => {
    expect(result.cashuModule).toBeDefined()
    expect(result.cashuModule.initialize).toBeTypeOf('function')
  })

  it('should expose recovery, incomingPayment, and pendingItems use cases', () => {
    expect(result.recovery).toBeDefined()
    expect(result.incomingPayment).toBeDefined()
    expect(result.pendingItems).toBeDefined()
  })

  it('should create a real EventBus (not mocked)', () => {
    const handler = vi.fn()
    const unsub = result.eventBus.on('balance:changed', handler)

    result.eventBus.emit({
      type: 'balance:changed',
      payload: { moduleId: 'cashu', accountId: 'mint-1' },
    })

    expect(handler).toHaveBeenCalledOnce()
    unsub()
  })

  it('should provide PaymentUseCase with correct interface', () => {
    expect(result.payment.getAccounts).toBeTypeOf('function')
    expect(result.payment.send).toBeTypeOf('function')
    expect(result.payment.receive).toBeTypeOf('function')
    expect(result.payment.estimateFee).toBeTypeOf('function')
    expect(result.payment.recoverAll).toBeTypeOf('function')
  })

  it('should provide BalanceUseCase with correct interface', () => {
    expect(result.balance.getTotal).toBeTypeOf('function')
    expect(result.balance.getByModule).toBeTypeOf('function')
  })

  it('should provide SwapUseCase with correct interface', () => {
    expect(result.swap.getAvailableSwaps).toBeTypeOf('function')
    expect(result.swap.estimateSwap).toBeTypeOf('function')
    expect(result.swap.executeSwap).toBeTypeOf('function')
  })

  it('should provide ContactUseCase with correct interface', () => {
    expect(result.contact.list).toBeTypeOf('function')
    expect(result.contact.create).toBeTypeOf('function')
    expect(result.contact.update).toBeTypeOf('function')
    expect(result.contact.delete).toBeTypeOf('function')
  })
})
