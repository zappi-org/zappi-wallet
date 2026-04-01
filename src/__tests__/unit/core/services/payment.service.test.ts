import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PaymentService } from '@/core/services/payment.service'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import { sat, toNumber } from '@/core/domain/amount'

// ─── Mocks ───

function createMockAdapter(overrides?: Partial<PaymentMethodAdapter>): PaymentMethodAdapter {
  return {
    id: 'cashu:lightning',
    moduleId: 'cashu',
    supportedUnits: ['sat'],
    capabilities: { canSend: true, canReceive: true, canEstimateFee: true },
    estimateFee: vi.fn().mockResolvedValue({ fee: sat(3), method: 'lightning', protocol: 'bolt11' }),
    prepareSend: vi.fn().mockResolvedValue({
      id: 'prepared-1', method: 'lightning', protocol: 'bolt11',
      amount: sat(1000), fee: sat(3),
    }),
    executeSend: vi.fn().mockResolvedValue({ id: 'prepared-1', state: 'finalized' }),
    cancelPrepared: vi.fn().mockResolvedValue(undefined),
    reclaimFailed: vi.fn().mockResolvedValue(undefined),
    createReceiveRequest: vi.fn().mockResolvedValue({
      id: 'req-1', method: 'lightning', protocol: 'bolt11',
      encoded: 'lnbc...', amount: sat(1000),
    }),
    redeem: vi.fn().mockResolvedValue({ amount: sat(500), method: 'lightning', protocol: 'bolt11' }),
    recoverPending: vi.fn().mockResolvedValue({ recovered: 0, failed: 0 }),
    ...overrides,
  }
}

function createMockModule(adapters: PaymentMethodAdapter[]): WalletModule {
  return {
    id: 'cashu',
    displayName: 'Cashu',
    initialize: vi.fn(),
    dispose: vi.fn(),
    isEnabled: vi.fn().mockReturnValue(true),
    getPaymentAdapters: vi.fn().mockReturnValue(adapters),
    getCapabilities: vi.fn().mockReturnValue([]),
    getBalance: vi.fn().mockResolvedValue({
      moduleId: 'cashu',
      accounts: [{ id: 'https://mint.test', label: 'Test Mint', amount: sat(5000) }],
      total: sat(5000),
    }),
    on: vi.fn().mockReturnValue(() => {}),
  }
}

function createMockTxRepo(): TransactionRepository {
  return {
    save: vi.fn().mockResolvedValue(undefined),
    getById: vi.fn().mockResolvedValue(null),
    list: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue(undefined),
  }
}

function createMockEventBus(): EventBus {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => {}),
    off: vi.fn(),
  }
}

describe('PaymentService', () => {
  let service: PaymentService
  let adapter: PaymentMethodAdapter
  let module: WalletModule
  let txRepo: TransactionRepository
  let eventBus: EventBus

  beforeEach(() => {
    adapter = createMockAdapter()
    module = createMockModule([adapter])
    txRepo = createMockTxRepo()
    eventBus = createMockEventBus()
    service = new PaymentService([module], txRepo, eventBus)
  })

  // ─── getAccounts ───

  describe('getAccounts', () => {
    it('returns balances from enabled modules', async () => {
      const result = await service.getAccounts()
      expect(result).toHaveLength(1)
      expect(result[0].moduleId).toBe('cashu')
    })

    it('skips disabled modules', async () => {
      vi.mocked(module.isEnabled).mockReturnValue(false)
      const result = await service.getAccounts()
      expect(result).toHaveLength(0)
    })
  })

  // ─── getMethodsForAccount ───

  describe('getMethodsForAccount', () => {
    it('returns PaymentMethodInfo DTOs, not adapter instances', () => {
      const methods = service.getMethodsForAccount('https://mint.test')

      expect(methods).toHaveLength(1)
      expect(methods[0].id).toBe('cashu:lightning')
      expect(methods[0].moduleId).toBe('cashu')
      expect(methods[0].capabilities.canSend).toBe(true)
      // Should be a plain object, not the adapter instance
      expect(methods[0]).not.toBe(adapter)
      expect(methods[0]).not.toHaveProperty('prepareSend')
    })
  })

  // ─── send ───

  describe('send', () => {
    it('orchestrates prepare → execute → tx record → events', async () => {
      const result = await service.send({
        accountId: 'https://mint.test',
        adapterId: 'cashu:lightning',
        destination: 'lnbc1000n1...',
        amount: sat(1000),
        memo: 'test',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.state).toBe('finalized')
      expect(adapter.prepareSend).toHaveBeenCalled()
      expect(adapter.executeSend).toHaveBeenCalledWith('prepared-1')
      expect(txRepo.save).toHaveBeenCalled()
      expect(txRepo.update).toHaveBeenCalled()
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment:completed' }),
      )
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'balance:changed' }),
      )
    })

    it('returns error for unknown adapter', async () => {
      const result = await service.send({
        accountId: 'https://mint.test',
        adapterId: 'unknown:adapter',
        destination: 'lnbc...',
        amount: sat(1000),
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('ADAPTER_NOT_FOUND')
    })

    it('handles execute failure gracefully', async () => {
      vi.mocked(adapter.executeSend).mockRejectedValue(new Error('melt failed'))

      const result = await service.send({
        accountId: 'https://mint.test',
        adapterId: 'cashu:lightning',
        destination: 'lnbc...',
        amount: sat(1000),
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.message).toBe('melt failed')
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment:failed' }),
      )
    })

    it('cancels prepared payment on execute failure to prevent proof leak', async () => {
      vi.mocked(adapter.executeSend).mockRejectedValue(new Error('melt failed'))

      await service.send({
        accountId: 'https://mint.test',
        adapterId: 'cashu:lightning',
        destination: 'lnbc...',
        amount: sat(1000),
      })

      expect(adapter.cancelPrepared).toHaveBeenCalledWith('prepared-1')
    })

    it('passes options to adapter', async () => {
      const ecashAdapter = createMockAdapter({ id: 'cashu:ecash' })
      const mod = createMockModule([ecashAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      await service.send({
        accountId: 'https://mint.test',
        adapterId: 'cashu:ecash',
        destination: 'creq...',
        amount: sat(500),
        options: { target: { type: 'p2pk', pubkey: '02abc' } },
      })

      expect(ecashAdapter.prepareSend).toHaveBeenCalledWith(
        expect.objectContaining({
          options: { target: { type: 'p2pk', pubkey: '02abc' } },
        }),
      )
    })
  })

  // ─── receive ───

  describe('receive', () => {
    it('creates receive request and records transaction', async () => {
      const mockAdapter = createMockAdapter({
        createReceiveRequest: vi.fn().mockResolvedValue({
          id: 'quote-1', method: 'lightning', protocol: 'bolt11',
          encoded: 'lnbc1000...', amount: sat(1000),
        }),
      })
      const mod = createMockModule([mockAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.receive({
        accountId: 'https://mint.test',
        adapterId: 'cashu:lightning',
        amount: sat(1000),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.encoded).toBe('lnbc1000...')
      expect(txRepo.save).toHaveBeenCalled()
    })

  })

  // ─── estimateFee ───

  describe('estimateFee', () => {
    it('delegates to adapter', async () => {
      const result = await service.estimateFee({
        accountId: 'https://mint.test',
        adapterId: 'cashu:lightning',
        destination: 'lnbc...',
        amount: sat(1000),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(toNumber(result.value.fee)).toBe(3)
    })

    it('returns error for unknown adapter', async () => {
      const result = await service.estimateFee({
        accountId: 'https://mint.test',
        adapterId: 'nonexistent',
        destination: 'lnbc...',
        amount: sat(1000),
      })

      expect(result.ok).toBe(false)
    })
  })

  // ─── redeem ───

  describe('redeem', () => {
    it('delegates to adapter redeem', async () => {
      const ecashAdapter = createMockAdapter({
        id: 'cashu:ecash',
        redeem: vi.fn().mockResolvedValue({ requestId: '', amount: sat(500), method: 'ecash', protocol: 'cashu-token', completed: true }),
      })
      const mod = createMockModule([ecashAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.redeem({
        adapterId: 'cashu:ecash',
        input: 'cashuBtest...',
      })

      expect(result.ok).toBe(true)
      expect(ecashAdapter.redeem).toHaveBeenCalledWith('cashuBtest...')
    })

    it('returns error when adapter not found', async () => {
      const result = await service.redeem({
        adapterId: 'nonexistent',
        input: 'cashuBtest...',
      })

      expect(result.ok).toBe(false)
    })
  })

  // ─── recoverAll ───

  describe('recoverAll', () => {
    it('recovers from all adapters', async () => {
      vi.mocked(adapter.recoverPending).mockResolvedValue({ recovered: 2, failed: 1 })

      const reports = await service.recoverAll()

      expect(reports).toHaveLength(1)
      expect(reports[0].recovered).toBe(2)
      expect(reports[0].failed).toBe(1)
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'recovery:completed' }),
      )
    })

    it('handles adapter recovery failure', async () => {
      vi.mocked(adapter.recoverPending).mockRejectedValue(new Error('recovery failed'))

      const reports = await service.recoverAll()

      expect(reports).toHaveLength(1)
      expect(reports[0].recovered).toBe(0)
      expect(reports[0].failed).toBe(1)
    })

    it('skips disabled modules', async () => {
      vi.mocked(module.isEnabled).mockReturnValue(false)

      const reports = await service.recoverAll()
      expect(reports).toHaveLength(0)
    })
  })
})
