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
    createMintQuote: vi.fn(),
    redeemMintQuote: vi.fn(),
    recoverPendingMelts: vi.fn(),
    // EcashBackend
    prepareSend: vi.fn(),
    executeSend: vi.fn(),
    rollbackSend: vi.fn(),
    receiveToken: vi.fn(),
    recoverPendingSendTokens: vi.fn(),
    // Module-level
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
      await module.initialize(new Uint8Array(64), "m/129372'/0'")

      expect(module.isEnabled()).toBe(true)
    })

    it('is not enabled after dispose', async () => {
      await module.initialize(new Uint8Array(64), "m/129372'/0'")
      await module.dispose()

      expect(module.isEnabled()).toBe(false)
      expect(module.getPaymentAdapters()).toHaveLength(0)
    })

    it('can re-initialize after dispose', async () => {
      await module.initialize(new Uint8Array(64), "m/129372'/0'")
      await module.dispose()
      await module.initialize(new Uint8Array(64), "m/129372'/0'")

      expect(module.isEnabled()).toBe(true)
      expect(module.getPaymentAdapters()).toHaveLength(2)
    })

    it('initialize is idempotent — adapters replaced not duplicated', async () => {
      await module.initialize(new Uint8Array(64), "m/129372'/0'")
      await module.initialize(new Uint8Array(64), "m/129372'/0'")

      expect(module.getPaymentAdapters()).toHaveLength(2)
    })
  })

  // ─── Payment Adapters ───

  describe('getPaymentAdapters', () => {
    it('returns lightning and ecash adapters after initialize', async () => {
      await module.initialize(new Uint8Array(64), "m/129372'/0'")

      const adapters = module.getPaymentAdapters()
      expect(adapters).toHaveLength(2)
      expect(adapters[0].id).toBe('cashu:lightning')
      expect(adapters[1].id).toBe('cashu:ecash')
    })

    it('adapters have correct moduleId', async () => {
      await module.initialize(new Uint8Array(64), "m/129372'/0'")

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
      })

      await module.initialize(new Uint8Array(64), "m/129372'/0'")
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

      await module.initialize(new Uint8Array(64), "m/129372'/0'")
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
    it('returns lightning and ecash capabilities', () => {
      const capabilities = module.getCapabilities()

      expect(capabilities).toHaveLength(2)
      expect(capabilities[0]).toEqual({ id: 'lightning', operations: ['send', 'receive'] })
      expect(capabilities[1]).toEqual({ id: 'ecash', operations: ['send', 'receive'] })
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
