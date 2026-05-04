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
      id: 'req-1', method: 'bolt11', protocol: 'bolt11',
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
    recoverAccount: vi.fn().mockResolvedValue(undefined),
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

  describe('reclaim', () => {
    it('emits send:reclaimed semantic event on reclaim', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue({
        id: 'tx-reclaim',
        direction: 'send',
        method: 'cashu:bolt11',
        protocol: 'cashu-token',
        amount: sat(1000),
        accountId: 'https://mint.test',
        status: 'pending',
        outcome: 'unclaimed',
        createdAt: Date.now(),
        metadata: { operationId: 'op-reclaim' },
      })

      const result = await service.reclaim({ transactionId: 'tx-reclaim' })

      expect(result.ok).toBe(true)
      expect(adapter.cancelPrepared).toHaveBeenCalledWith('op-reclaim')
      expect(eventBus.emit).toHaveBeenCalledWith({
        type: 'send:reclaimed',
        payload: {
          txId: 'tx-reclaim',
          method: 'cashu:bolt11',
          protocol: 'cashu-token',
          amount: sat(1000),
        },
      })
      expect(eventBus.emit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'payment:completed' }),
      )
    })
  })

  // ─── receive ───

  describe('receive', () => {
    it('creates receive request without recording a premature transaction', async () => {
      const mockAdapter = createMockAdapter({
        createReceiveRequest: vi.fn().mockResolvedValue({
          id: 'quote-1', method: 'bolt11', protocol: 'bolt11',
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
      expect(txRepo.save).not.toHaveBeenCalled()
    })

    it('resolves by protocol hint', async () => {
      const bolt11Adapter = createMockAdapter({
        id: 'cashu:bolt11', protocol: 'bolt11',
        createReceiveRequest: vi.fn().mockResolvedValue({
          id: 'quote-bolt11', method: 'bolt11', protocol: 'bolt11',
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
          id: 'quote-1', method: 'bolt11', protocol: 'bolt11',
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

  // ─── recoverAccounts ───

  describe('recoverAccounts', () => {
    it('delegates account recovery to enabled wallet module', async () => {
      const reports = await service.recoverAccounts({ accountIds: ['https://mint.test'] })

      expect(module.recoverAccount).toHaveBeenCalledWith('https://mint.test')
      expect(reports).toEqual([
        { moduleId: 'cashu', accountId: 'https://mint.test', success: true },
      ])
      expect(eventBus.emit).toHaveBeenCalledWith({
        type: 'balance:changed',
        payload: { moduleId: 'cashu', accountId: 'https://mint.test' },
      })
    })

    it('reports account recovery failures without throwing', async () => {
      vi.mocked(module.recoverAccount).mockRejectedValue(new Error('restore failed'))

      const reports = await service.recoverAccounts({ accountIds: ['https://mint.test'] })

      expect(reports).toEqual([
        {
          moduleId: 'cashu',
          accountId: 'https://mint.test',
          success: false,
          error: 'restore failed',
        },
      ])
    })

    it('reports failure when no enabled module exists', async () => {
      vi.mocked(module.isEnabled).mockReturnValue(false)

      const reports = await service.recoverAccounts({ accountIds: ['https://mint.test'] })

      expect(reports).toEqual([
        {
          moduleId: 'unknown',
          accountId: 'https://mint.test',
          success: false,
          error: 'No module found for account: https://mint.test',
        },
      ])
    })
  })

  // ─── quoteReclaim ───

  describe('quoteReclaim', () => {
    const TX_ID = 'tx-reclaim-1'

    function buildUnclaimedTx(overrides?: Record<string, unknown>) {
      return {
        id: TX_ID,
        direction: 'send' as const,
        method: 'cashu:bolt11',
        protocol: 'bolt11',
        amount: sat(1000),
        accountId: 'https://mint.test',
        status: 'pending' as const,
        outcome: 'unclaimed' as const,
        createdAt: Date.now(),
        metadata: {},
        ...overrides,
      }
    }

    it('delegates to adapter.estimateReclaimFee with the transaction', async () => {
      const tx = buildUnclaimedTx()
      vi.mocked(txRepo.getById).mockResolvedValue(tx as never)
      adapter.estimateReclaimFee = vi.fn().mockResolvedValue({
        grossAmount: sat(1000),
        fee: sat(2),
        netAmount: sat(998),
      })

      const result = await service.quoteReclaim({ transactionId: TX_ID })

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(toNumber(result.value.fee)).toBe(2)
        expect(toNumber(result.value.netAmount)).toBe(998)
      }
      expect(adapter.estimateReclaimFee).toHaveBeenCalledWith(tx)
    })

    it('returns UNKNOWN when transaction is missing', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(null)

      const result = await service.quoteReclaim({ transactionId: TX_ID })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('UNKNOWN')
    })

    it('returns UNKNOWN when transaction outcome is not unclaimed', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(buildUnclaimedTx({ outcome: 'claimed' }) as never)

      const result = await service.quoteReclaim({ transactionId: TX_ID })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('UNKNOWN')
    })

    it('returns ADAPTER_NOT_FOUND when the adapter id does not resolve', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(
        buildUnclaimedTx({ method: 'nonexistent:adapter' }) as never,
      )

      const result = await service.quoteReclaim({ transactionId: TX_ID })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('ADAPTER_NOT_FOUND')
    })

    it('returns ADAPTER_NOT_FOUND when adapter does not implement estimateReclaimFee', async () => {
      adapter.estimateReclaimFee = undefined
      vi.mocked(txRepo.getById).mockResolvedValue(buildUnclaimedTx() as never)

      const result = await service.quoteReclaim({ transactionId: TX_ID })

      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.code).toBe('ADAPTER_NOT_FOUND')
    })

    it('wraps adapter throw as UNKNOWN (including missing token metadata)', async () => {
      vi.mocked(txRepo.getById).mockResolvedValue(buildUnclaimedTx() as never)
      adapter.estimateReclaimFee = vi.fn().mockRejectedValue(new Error('no token'))

      const result = await service.quoteReclaim({ transactionId: TX_ID })

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error.code).toBe('UNKNOWN')
        expect(result.error.message).toContain('no token')
      }
    })
  })
})
