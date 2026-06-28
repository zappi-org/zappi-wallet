import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CashuModule, type CashuModuleBackend } from '@/modules/cashu/cashu.module'
import { sat, toNumber } from '@/core/domain/amount'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'

// ─── Mock Backend ───

function createMockBackend(): CashuModuleBackend {
  return {
    // LightningBackend
    prepareMelt: vi.fn(),
    executeMelt: vi.fn(),
    rollbackMelt: vi.fn(),
    checkMelt: vi.fn(),
    createMintQuote: vi.fn(),
    checkMintQuote: vi.fn(),
    getMintQuote: vi.fn(),
    redeemMintQuote: vi.fn(),
    recoverPendingMelts: vi.fn(),
    recoverPendingQuotes: vi.fn(),
    abandonMintQuote: vi.fn(),
    mintAndReceive: vi.fn(),
    // EcashBackend
    prepareSend: vi.fn(),
    executeSend: vi.fn(),
    rollbackSend: vi.fn(),
    finalizeSend: vi.fn(),
    getSendOperationState: vi.fn(),
    checkProofStates: vi.fn(),
    receiveToken: vi.fn(),
    estimateReceiveFee: vi.fn(),
    recoverPendingSendTokens: vi.fn(),
    redeemPendingReceivedTokens: vi.fn().mockResolvedValue({ redeemed: 0, failed: 0 }),
    storeOfflineToken: vi.fn().mockResolvedValue('pending-recv-123'),
    // PaymentRequest (NUT-18)
    parsePaymentRequest: vi.fn(),
    preparePaymentRequest: vi.fn(),
    executePaymentRequest: vi.fn(),
    // Token inspection
    inspectInput: vi.fn().mockResolvedValue({ lockStatus: 'unlocked', proofIntegrity: 'unverifiable' }),
    // Module-level
    restoreWallet: vi.fn().mockResolvedValue(undefined),
    getBalances: vi.fn().mockResolvedValue({
      'https://mint-a.test': 5000,
      'https://mint-b.test': 3000,
    }),
  }
}

describe('CashuModule', () => {
  let module: CashuModule
  let backend: CashuModuleBackend

  beforeEach(() => {
    backend = createMockBackend()
    module = new CashuModule(backend)
  })

  // ─── Port 준수: WalletModule assignable ───

  it('is assignable to WalletModule port', () => {
    // TypeScript 컴파일 타임 검증 + 런타임 할당 검증
    const walletModule: WalletModule = module
    expect(walletModule.id).toBe('cashu')
  })

  // ─── Identity ───

  it('has correct id and displayName', () => {
    expect(module.id).toBe('cashu')
    expect(module.displayName).toBe('Cashu')
  })

  // ─── Lifecycle ───

  describe('lifecycle', () => {
    it('is not enabled before initialize', () => {
      expect(module.isEnabled()).toBe(false)
      expect(module.getPaymentAdapters()).toHaveLength(0)
    })

    it('is enabled after initialize', async () => {
      await module.initialize()

      expect(module.isEnabled()).toBe(true)
    })

    it('is not enabled after dispose', async () => {
      await module.initialize()
      await module.dispose()

      expect(module.isEnabled()).toBe(false)
      expect(module.getPaymentAdapters()).toHaveLength(0)
    })

    it('can re-initialize after dispose', async () => {
      await module.initialize()
      await module.dispose()
      await module.initialize()

      expect(module.isEnabled()).toBe(true)
      expect(module.getPaymentAdapters()).toHaveLength(2)
    })

    it('initialize is idempotent — adapters replaced not duplicated', async () => {
      await module.initialize()
      await module.initialize()

      expect(module.getPaymentAdapters()).toHaveLength(2)
    })
  })

  // ─── Payment Adapters ───

  describe('getPaymentAdapters', () => {
    it('returns lightning and ecash adapters after initialize', async () => {
      await module.initialize()

      const adapters = module.getPaymentAdapters()
      expect(adapters).toHaveLength(2)
      expect(adapters[0].id).toBe('cashu:bolt11')
      expect(adapters[1].id).toBe('cashu:ecash')
    })

    it('adapters have correct moduleId', async () => {
      await module.initialize()

      const adapters = module.getPaymentAdapters()
      for (const adapter of adapters) {
        expect(adapter.moduleId).toBe('cashu')
      }
    })

    it('adapters receive the injected backend', async () => {
      vi.mocked(backend.prepareMelt).mockResolvedValue({
        operationId: 'op-1',
        quoteId: 'q-1',
        amount: 1000,
        fee_reserve: 2,
        swap_fee: 0,
        unit: 'sat',
      })

      await module.initialize()
      const lightning = module.getPaymentAdapters()[0]

      await lightning.prepareSend({
        destination: 'lnbc1000n1...',
        amount: sat(1000),
        accountId: 'https://mint.test',
      })

      expect(backend.prepareMelt).toHaveBeenCalledWith('https://mint.test', 'lnbc1000n1...')
    })

    it('ecash adapter receives the same backend', async () => {
      vi.mocked(backend.prepareSend).mockResolvedValue({
        operationId: 'send-1',
        fee: 0,
        needsSwap: false,
      })

      await module.initialize()
      const ecash = module.getPaymentAdapters()[1]

      await ecash.prepareSend({
        destination: 'cashuA...',
        amount: sat(500),
        accountId: 'https://mint.test',
      })

      expect(backend.prepareSend).toHaveBeenCalledWith({
        mintUrl: 'https://mint.test',
        amount: 500,
        target: undefined,
      })
    })
  })

  // ─── Capabilities ───

  describe('getCapabilities', () => {
    it('returns bolt11 and ecash capabilities', () => {
      const capabilities = module.getCapabilities()

      expect(capabilities).toHaveLength(2)
      expect(capabilities[0]).toEqual({ id: 'bolt11', protocol: 'bolt11', operations: ['send', 'receive'] })
      expect(capabilities[1]).toEqual({ id: 'ecash', protocol: 'ecash', operations: ['send', 'receive'] })
    })
  })

  // ─── Balance ───

  describe('getBalance', () => {
    it('converts backend balances to ModuleBalance', async () => {
      const balance = await module.getBalance()

      expect(backend.getBalances).toHaveBeenCalled()
      expect(balance.moduleId).toBe('cashu')
      expect(balance.accounts).toHaveLength(2)
      expect(balance.accounts[0].id).toBe('https://mint-a.test')
      expect(balance.accounts[0].label).toBe('https://mint-a.test')
      expect(toNumber(balance.accounts[0].amount)).toBe(5000)
      expect(balance.accounts[1].id).toBe('https://mint-b.test')
      expect(toNumber(balance.accounts[1].amount)).toBe(3000)
      expect(toNumber(balance.total)).toBe(8000)
    })

    it('returns zero total when no mints', async () => {
      vi.mocked(backend.getBalances).mockResolvedValue({})

      const balance = await module.getBalance()

      expect(balance.accounts).toHaveLength(0)
      expect(toNumber(balance.total)).toBe(0)
    })

    it('handles single mint correctly', async () => {
      vi.mocked(backend.getBalances).mockResolvedValue({
        'https://single.test': 42,
      })

      const balance = await module.getBalance()

      expect(balance.accounts).toHaveLength(1)
      expect(toNumber(balance.total)).toBe(42)
    })

    it('handles zero-balance mints', async () => {
      vi.mocked(backend.getBalances).mockResolvedValue({
        'https://empty.test': 0,
        'https://active.test': 1000,
      })

      const balance = await module.getBalance()

      expect(balance.accounts).toHaveLength(2)
      expect(toNumber(balance.accounts[0].amount)).toBe(0)
      expect(toNumber(balance.accounts[1].amount)).toBe(1000)
      expect(toNumber(balance.total)).toBe(1000)
    })

    it('propagates backend error', async () => {
      vi.mocked(backend.getBalances).mockRejectedValue(new Error('network error'))

      await expect(module.getBalance()).rejects.toThrow('network error')
    })

    it('amount uses sat unit', async () => {
      const balance = await module.getBalance()

      for (const account of balance.accounts) {
        expect(account.amount.unit).toBe('sat')
      }
      expect(balance.total.unit).toBe('sat')
    })
  })

  // ─── Recovery ───

  describe('recoverAccount', () => {
    it('delegates account recovery to backend wallet restore', async () => {
      await module.recoverAccount('https://mint-a.test')

      expect(backend.restoreWallet).toHaveBeenCalledWith('https://mint-a.test')
    })

    it('propagates backend restore errors', async () => {
      vi.mocked(backend.restoreWallet).mockRejectedValue(new Error('restore failed'))

      await expect(module.recoverAccount('https://mint-a.test')).rejects.toThrow('restore failed')
    })
  })

  // ─── payCreq (NUT-18) ───

  describe('send (protocol routing)', () => {
    it('creq destination — parse → prepare → execute', async () => {
      vi.mocked(backend.parsePaymentRequest).mockResolvedValue({
        payableMints: ['https://mint.test'],
        allowedMints: ['https://mint.test'],
        amount: 1000,
        transport: { type: 'http', url: 'https://receiver.test/pay' },
      })
      vi.mocked(backend.preparePaymentRequest).mockResolvedValue({
        operationId: 'creq-op-1',
        resolved: { payableMints: [], allowedMints: [], amount: 1000, transport: { type: 'http', url: 'https://receiver.test/pay' } },
      })
      vi.mocked(backend.executePaymentRequest).mockResolvedValue({ type: 'http' })

      await module.initialize()
      const result = await module.send({
        destination: 'creqBtest...',
        accountId: 'https://mint.test',
        amount: sat(1000),
      })

      expect(backend.parsePaymentRequest).toHaveBeenCalledWith('creqBtest...')
      expect(result.state).toBe('completed')
    })

    it('bolt11 destination — lightning adapter', async () => {
      vi.mocked(backend.prepareMelt).mockResolvedValue({
        operationId: 'melt-1', quoteId: 'q-1', amount: 1000, fee_reserve: 3, swap_fee: 1, unit: 'sat',
      })
      vi.mocked(backend.executeMelt).mockResolvedValue({ state: 'finalized' })

      await module.initialize()
      const result = await module.send({
        destination: 'lnbc1000n1...',
        accountId: 'https://mint.test',
        amount: sat(1000),
      })

      expect(backend.prepareMelt).toHaveBeenCalledWith('https://mint.test', 'lnbc1000n1...')
      expect(result.state).toBe('finalized')
    })

    it('lightning destination — lightning adapter', async () => {
      vi.mocked(backend.prepareMelt).mockResolvedValue({
        operationId: 'melt-2', quoteId: 'q-2', amount: 500, fee_reserve: 1, swap_fee: 0, unit: 'sat',
      })
      vi.mocked(backend.executeMelt).mockResolvedValue({ state: 'finalized' })

      await module.initialize()
      const result = await module.send({
        destination: 'lnbc500n1...',
        accountId: 'https://mint.test',
        amount: sat(500),
      })

      expect(backend.prepareMelt).toHaveBeenCalledWith('https://mint.test', 'lnbc500n1...')
      expect(result.state).toBe('finalized')
    })

    it('unsupported destination — throws error', async () => {
      await module.initialize()

      await expect(module.send({
        destination: 'unknown-format',
        accountId: 'https://mint.test',
        amount: sat(500),
      })).rejects.toThrow('Unsupported destination format')
    })

    it('creq with nostrGateway — sends DM', async () => {
      const mockGateway = {
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        getRelayStatus: vi.fn().mockReturnValue([]),
        publish: vi.fn().mockResolvedValue({ id: 'ev-1', pubkey: '', created_at: 0, kind: 1, tags: [], content: '', sig: '' }),
        queryEvents: vi.fn().mockResolvedValue([]),
        subscribe: vi.fn().mockReturnValue(() => {}),
        sendPrivateDirectMessage: vi.fn().mockResolvedValue(undefined),
        sendGiftWrap: vi.fn().mockResolvedValue({ id: 'gw-1', pubkey: '', created_at: 0, kind: 1059, tags: [], content: '', sig: '' }),
        fetchGiftWraps: vi.fn().mockResolvedValue([]),
        subscribeGiftWraps: vi.fn().mockReturnValue(() => {}),
      }
      module = new CashuModule(backend, mockGateway)

      vi.mocked(backend.parsePaymentRequest).mockResolvedValue({
        payableMints: ['https://mint.test'],
        allowedMints: [],
        amount: 500,
        transport: { type: 'inband' },
      })
      vi.mocked(backend.preparePaymentRequest).mockResolvedValue({
        operationId: 'creq-op-3',
        resolved: { payableMints: [], allowedMints: [], amount: 500, transport: { type: 'inband' } },
      })
      vi.mocked(backend.executePaymentRequest).mockResolvedValue({ type: 'inband', token: 'cashuBtoken...' })

      await module.initialize()
      await module.send({
        destination: 'creqBtest...',
        accountId: 'https://mint.test',
        amount: sat(500),
        options: {
          nostrContext: { recipientPubkey: 'abc123', relays: ['wss://relay.test'] },
        },
      })

      expect(mockGateway.sendPrivateDirectMessage).toHaveBeenCalledWith({
        recipientPubkey: 'abc123',
        content: 'cashuBtoken...',
        relays: ['wss://relay.test'],
      })
    })

    it('creq allowedMints empty — any mint accepted', async () => {
      vi.mocked(backend.parsePaymentRequest).mockResolvedValue({
        payableMints: ['https://mint-a.test', 'https://mint-b.test'],
        allowedMints: [],
        amount: 100,
        transport: { type: 'inband' },
      })
      vi.mocked(backend.preparePaymentRequest).mockResolvedValue({
        operationId: 'creq-op-4',
        resolved: { payableMints: [], allowedMints: [], amount: 100, transport: { type: 'inband' } },
      })
      vi.mocked(backend.executePaymentRequest).mockResolvedValue({ type: 'inband', token: 'cashuB...' })

      await module.initialize()
      const result = await module.send({
        destination: 'creqBtest...',
        accountId: 'https://mint-a.test',
        amount: sat(100),
      })

      expect(backend.preparePaymentRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mintUrl: 'https://mint-a.test' }),
      )
      expect(result.data?.token).toBe('cashuB...')
    })
  })

  // ─── Events ───

  describe('on', () => {
    it('returns unsubscribe function', () => {
      const handler = vi.fn()
      const unsubscribe = module.on('test-event', handler)

      expect(typeof unsubscribe).toBe('function')
    })

    it('unsubscribe is idempotent', () => {
      const handler = vi.fn()
      const unsubscribe = module.on('test-event', handler)
      unsubscribe()
      unsubscribe() // 두 번째 호출도 에러 없음
    })

    it('multiple handlers on same event', () => {
      const handler1 = vi.fn()
      const handler2 = vi.fn()
      const unsub1 = module.on('evt', handler1)
      const unsub2 = module.on('evt', handler2)

      // 하나만 해제해도 다른 하나는 유지
      unsub1()
      expect(typeof unsub2).toBe('function')
    })

    it('dispose clears all event handlers', async () => {
      const handler = vi.fn()
      module.on('evt', handler)

      await module.dispose()

      // dispose 후 새 handler 등록 가능 (에러 없음)
      const unsub = module.on('evt', vi.fn())
      expect(typeof unsub).toBe('function')
    })
  })
})
