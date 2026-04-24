import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PaymentService } from '@/core/services/payment.service'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import { sat, toNumber } from '@/core/domain/amount'
import { RedeemFeeTooHighError } from '@/core/errors/payment.errors'

// ─── Mocks ───

function createMockAdapter(overrides?: Partial<PaymentMethodAdapter>): PaymentMethodAdapter {
  return {
    id: 'cashu:bolt11',
    moduleId: 'cashu',
    protocol: 'bolt11',
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
    send: vi.fn().mockResolvedValue({ operationId: 'op-1', state: 'completed' }),
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
    delete: vi.fn().mockResolvedValue(undefined),
    findAll: vi.fn().mockResolvedValue([]),
    deleteAll: vi.fn().mockResolvedValue(undefined),
    deleteOlderThan: vi.fn().mockResolvedValue(undefined),
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
      expect(methods[0].id).toBe('cashu:bolt11')
      expect(methods[0].protocol).toBe('bolt11')
      expect(methods[0].moduleId).toBe('cashu')
      expect(methods[0].capabilities.canSend).toBe(true)
      // Should be a plain object, not the adapter instance
      expect(methods[0]).not.toBe(adapter)
      expect(methods[0]).not.toHaveProperty('prepareSend')
    })
  })

  // ─── send ───

  describe('send', () => {
    it('delegates to module.send and records tx + events', async () => {
      const result = await service.send({
        accountId: 'https://mint.test',
        destination: 'lnbc1000n1...',
        amount: sat(1000),
        memo: 'test',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.state).toBe('completed')
      expect(module.send).toHaveBeenCalledWith(expect.objectContaining({
        destination: 'lnbc1000n1...',
        accountId: 'https://mint.test',
      }))
      expect(txRepo.save).toHaveBeenCalled()
      expect(txRepo.update).toHaveBeenCalled()
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment:completed' }),
      )
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'balance:changed' }),
      )
    })

    it('returns error when no module found for account', async () => {
      const disabledMod = createMockModule([adapter])
      vi.mocked(disabledMod.isEnabled).mockReturnValue(false)
      service = new PaymentService([disabledMod], txRepo, eventBus)

      const result = await service.send({
        accountId: 'https://unknown.test',
        destination: 'lnbc...',
        amount: sat(1000),
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('MODULE_NOT_FOUND')
    })

    it('handles module.send failure gracefully', async () => {
      vi.mocked(module.send).mockRejectedValue(new Error('send failed'))

      const result = await service.send({
        accountId: 'https://mint.test',
        destination: 'lnbc...',
        amount: sat(1000),
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.message).toBe('send failed')
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment:failed' }),
      )
    })

    it('passes options to module.send', async () => {
      await service.send({
        accountId: 'https://mint.test',
        destination: 'creqBtest...',
        amount: sat(500),
        options: { lockingCondition: { kind: 'P2PK', data: '02abc' } },
      })

      expect(module.send).toHaveBeenCalledWith(
        expect.objectContaining({
          options: { lockingCondition: { kind: 'P2PK', data: '02abc' } },
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
        protocol: 'bolt11',
        amount: sat(1000),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.encoded).toBe('lnbc1000...')
      expect(txRepo.save).toHaveBeenCalled()
    })

    it('resolves by protocol hint', async () => {
      const bolt11Adapter = createMockAdapter({
        id: 'cashu:bolt11', protocol: 'bolt11',
        createReceiveRequest: vi.fn().mockResolvedValue({
          id: 'quote-bolt11', method: 'lightning', protocol: 'bolt11',
          encoded: 'lnbc...', amount: sat(1000),
        }),
      })
      const ecashAdapter = createMockAdapter({
        id: 'cashu:ecash', protocol: 'ecash',
        capabilities: { canSend: true, canReceive: true, canEstimateFee: true },
      })
      const mod = createMockModule([bolt11Adapter, ecashAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.receive({
        accountId: 'https://mint.test',
        protocol: 'bolt11',
        amount: sat(1000),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(bolt11Adapter.createReceiveRequest).toHaveBeenCalled()
    })

    it('without protocol resolves to first canReceive adapter', async () => {
      const mockAdapter = createMockAdapter({
        createReceiveRequest: vi.fn().mockResolvedValue({
          id: 'quote-1', method: 'lightning', protocol: 'bolt11',
          encoded: 'lnbc...', amount: sat(1000),
        }),
      })
      const mod = createMockModule([mockAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.receive({
        accountId: 'https://mint.test',
        amount: sat(1000),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(mockAdapter.createReceiveRequest).toHaveBeenCalled()
    })

  })

  // ─── estimateFee ───

  describe('estimateFee', () => {
    it('delegates to adapter', async () => {
      const result = await service.estimateFee({
        accountId: 'https://mint.test',
        destination: 'lnbc...',
        amount: sat(1000),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(toNumber(result.value.fee)).toBe(3)
    })

    it('infers protocol from lnbc destination', async () => {
      const bolt11Adapter = createMockAdapter({
        id: 'cashu:bolt11', protocol: 'bolt11',
        estimateFee: vi.fn().mockResolvedValue({ fee: sat(5), method: 'lightning', protocol: 'bolt11' }),
      })
      const ecashAdapter = createMockAdapter({
        id: 'cashu:ecash', protocol: 'ecash',
        capabilities: { canSend: true, canReceive: true, canEstimateFee: true },
      })
      const mod = createMockModule([bolt11Adapter, ecashAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.estimateFee({
        accountId: 'https://mint.test',
        destination: 'lnbc1000n1ptest...',
        amount: sat(1000),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(bolt11Adapter.estimateFee).toHaveBeenCalled()
    })

    it('returns error when no adapter matches destination', async () => {
      const disabledMod = createMockModule([adapter])
      vi.mocked(disabledMod.isEnabled).mockReturnValue(false)
      service = new PaymentService([disabledMod], txRepo, eventBus)

      const result = await service.estimateFee({
        accountId: 'https://mint.test',
        destination: 'lnbc...',
        amount: sat(1000),
      })

      expect(result.ok).toBe(false)
    })
  })

  // ─── redeem ───

  describe('redeem', () => {
    it('auto-detects ecash adapter from cashuA input', async () => {
      const ecashAdapter = createMockAdapter({
        id: 'cashu:ecash',
        canRedeem: vi.fn().mockImplementation((input: string) => /^cashu[ab]/i.test(input.trim())),
        redeem: vi.fn().mockResolvedValue({ requestId: 'tx-ecash-1', amount: sat(500), method: 'cashu:ecash', protocol: 'cashu-token', completed: true, accountId: 'https://mint.test' }),
      })
      const mod = createMockModule([ecashAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.redeem({
        input: 'cashuBtest...',
      })

      expect(result.ok).toBe(true)
      expect(ecashAdapter.redeem).toHaveBeenCalledWith('cashuBtest...')
      expect(txRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({
          direction: 'receive',
          method: 'cashu:ecash',
          accountId: 'https://mint.test',
          status: 'settled',
          outcome: 'claimed',
        }),
      )
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'balance:changed' }),
      )
    })

    it('no adapter matches — returns ADAPTER_NOT_FOUND', async () => {
      const bolt11Adapter = createMockAdapter({
        id: 'cashu:bolt11',
        canRedeem: vi.fn().mockReturnValue(false),
      })
      const mod = createMockModule([bolt11Adapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.redeem({
        input: 'garbage-input',
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('ADAPTER_NOT_FOUND')
    })

    it('preserves classified redeem fee errors from the adapter', async () => {
      const ecashAdapter = createMockAdapter({
        id: 'cashu:ecash',
        canRedeem: vi.fn().mockImplementation((input: string) => /^cashu[ab]/i.test(input.trim())),
        redeem: vi.fn().mockRejectedValue(new RedeemFeeTooHighError('Receive amount is not sufficient after fees')),
      })
      const mod = createMockModule([ecashAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.redeem({
        input: 'cashuBtest...',
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('REDEEM_FEE_TOO_HIGH')
      expect(result.error.message).toBe('Receive amount is not sufficient after fees')
    })
  })

  // ─── inspectInput ───

  describe('inspectInput', () => {
    it('delegates to adapter inspectInput and judges lockTarget', async () => {
      const ecashAdapter = createMockAdapter({
        id: 'cashu:ecash',
        canRedeem: vi.fn().mockImplementation((input: string) => /^cashu[ab]/i.test(input.trim())),
        inspectInput: vi.fn().mockResolvedValue({
          lockStatus: 'locked',
          lockTarget: '02abc',
          proofIntegrity: 'verified',
        }),
      })
      const mod = createMockModule([ecashAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.inspectInput({ input: 'cashuBtest...', recipientPubkey: '02abc' })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.lockStatus).toBe('locked-to-recipient')
      expect(result.value.proofIntegrity).toBe('verified')
    })

    it('returns locked-to-other when lockTarget does not match', async () => {
      const ecashAdapter = createMockAdapter({
        id: 'cashu:ecash',
        canRedeem: vi.fn().mockReturnValue(true),
        inspectInput: vi.fn().mockResolvedValue({
          lockStatus: 'locked',
          lockTarget: '02other',
          proofIntegrity: 'verified',
        }),
      })
      const mod = createMockModule([ecashAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.inspectInput({ input: 'cashuBtest...', recipientPubkey: '02abc' })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.lockStatus).toBe('locked-to-other')
    })

    it('returns not-supported when adapter has no inspectInput', async () => {
      const ecashAdapter = createMockAdapter({
        id: 'cashu:ecash',
        canRedeem: vi.fn().mockReturnValue(true),
      })
      delete (ecashAdapter as unknown as Record<string, unknown>).inspectInput
      const mod = createMockModule([ecashAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.inspectInput({ input: 'cashuBtest...' })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.lockStatus).toBe('not-supported')
      expect(result.value.proofIntegrity).toBe('not-supported')
    })

    it('returns ADAPTER_NOT_FOUND when no adapter matches', async () => {
      const bolt11Adapter = createMockAdapter({
        id: 'cashu:bolt11',
        canRedeem: vi.fn().mockReturnValue(false),
      })
      const mod = createMockModule([bolt11Adapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.inspectInput({ input: 'garbage' })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('ADAPTER_NOT_FOUND')
    })

    it('returns not-supported on inspectInput error', async () => {
      const ecashAdapter = createMockAdapter({
        id: 'cashu:ecash',
        canRedeem: vi.fn().mockReturnValue(true),
        inspectInput: vi.fn().mockRejectedValue(new Error('inspection failed')),
      })
      const mod = createMockModule([ecashAdapter])
      service = new PaymentService([mod], txRepo, eventBus)

      const result = await service.inspectInput({ input: 'cashuBtest...' })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.lockStatus).toBe('not-supported')
      expect(result.value.proofIntegrity).toBe('not-supported')
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
