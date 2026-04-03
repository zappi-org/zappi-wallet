import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SwapService } from '@/core/services/swap.service'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import { sat, toNumber } from '@/core/domain/amount'

// ─── Mocks ───

function createMockLightningAdapter(overrides?: Partial<PaymentMethodAdapter>): PaymentMethodAdapter {
  return {
    id: 'cashu:bolt11',
    moduleId: 'cashu',
    protocol: 'bolt11',
    supportedUnits: ['sat'],
    capabilities: { canSend: true, canReceive: true, canEstimateFee: true },
    estimateFee: vi.fn().mockResolvedValue({ fee: sat(3), method: 'lightning', protocol: 'bolt11' }),
    prepareSend: vi.fn().mockResolvedValue({
      id: 'melt-1', method: 'lightning', protocol: 'bolt11',
      amount: sat(1000), fee: sat(3),
    }),
    executeSend: vi.fn().mockResolvedValue({ id: 'melt-1', state: 'finalized' }),
    cancelPrepared: vi.fn(),
    reclaimFailed: vi.fn(),
    recoverPending: vi.fn().mockResolvedValue({ recovered: 0, failed: 0 }),
    createReceiveRequest: vi.fn().mockResolvedValue({
      id: 'quote-1', method: 'lightning', protocol: 'bolt11',
      encoded: 'lnbc1000n1...', amount: sat(1000),
    }),
    onReceiveCompleted: vi.fn().mockImplementation((_requestId, handler) => {
      // Simulate immediate completion for testing
      setTimeout(() => handler({ requestId: 'quote-1', amount: sat(1000), completedAt: Date.now() }), 0)
      return () => {}
    }),
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
    send: vi.fn().mockResolvedValue({ operationId: '', state: 'completed' }),
    getPaymentAdapters: vi.fn().mockReturnValue(adapters),
    getCapabilities: vi.fn().mockReturnValue([]),
    getBalance: vi.fn().mockResolvedValue({
      moduleId: 'cashu', accounts: [], total: sat(0),
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

describe('SwapService', () => {
  let service: SwapService
  let adapter: PaymentMethodAdapter
  let txRepo: TransactionRepository
  let eventBus: EventBus

  beforeEach(() => {
    adapter = createMockLightningAdapter()
    const module = createMockModule([adapter])
    txRepo = createMockTxRepo()
    eventBus = createMockEventBus()
    service = new SwapService([module], txRepo, eventBus)
  })

  // ─── getAvailableSwaps ───

  describe('getAvailableSwaps', () => {
    it('returns swap pair for module with lightning adapter', () => {
      const pairs = service.getAvailableSwaps()
      expect(pairs).toHaveLength(1)
      expect(pairs[0].moduleId).toBe('cashu')
    })

    it('returns empty for disabled module', () => {
      const disabledModule = createMockModule([adapter])
      vi.mocked(disabledModule.isEnabled).mockReturnValue(false)

      service = new SwapService([disabledModule], txRepo, eventBus)
      const pairs = service.getAvailableSwaps()
      expect(pairs).toHaveLength(0)
    })
  })

  // ─── estimateSwap ───

  describe('estimateSwap', () => {
    it('estimates swap fee', async () => {
      const result = await service.estimateSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(1000),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(toNumber(result.value.fee)).toBe(3)
      expect(adapter.createReceiveRequest).toHaveBeenCalled()
      expect(adapter.estimateFee).toHaveBeenCalled()
    })
  })

  // ─── executeSwap ───

  describe('executeSwap', () => {
    it('orchestrates full swap flow', async () => {
      const result = await service.executeSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(1000),
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.amount).toEqual(sat(1000))
      expect(toNumber(result.value.fee)).toBe(3)

      // Verify flow: createReceiveRequest → onReceiveCompleted → prepareSend → executeSend
      expect(adapter.createReceiveRequest).toHaveBeenCalled()
      expect(adapter.onReceiveCompleted).toHaveBeenCalled()
      expect(adapter.prepareSend).toHaveBeenCalledWith(
        expect.objectContaining({ destination: 'lnbc1000n1...' }),
      )
      expect(adapter.executeSend).toHaveBeenCalledWith('melt-1')

      // Verify transactions saved (send + receive)
      expect(txRepo.save).toHaveBeenCalledTimes(2)
      expect(txRepo.update).toHaveBeenCalledTimes(2)

      // Verify events
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'swap:completed' }),
      )
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'balance:changed' }),
      )
    })

    it('records linked transactions with intent swap', async () => {
      await service.executeSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(1000),
      })

      const saveCalls = vi.mocked(txRepo.save).mock.calls
      expect(saveCalls).toHaveLength(2)

      const sendTx = saveCalls[0][0]
      const receiveTx = saveCalls[1][0]

      expect(sendTx.direction).toBe('send')
      expect(sendTx.intent).toBe('swap')
      expect(receiveTx.direction).toBe('receive')
      expect(receiveTx.intent).toBe('swap')
      // Linked to each other
      expect(sendTx.linkedTxId).toBe(receiveTx.id)
      expect(receiveTx.linkedTxId).toBe(sendTx.id)
    })

    it('handles execute failure and emits swap:failed', async () => {
      vi.mocked(adapter.executeSend).mockRejectedValue(new Error('melt failed'))

      const result = await service.executeSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(1000),
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.code).toBe('SWAP_FAILED')

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'swap:failed' }),
      )
      // Failed transactions should be updated
      expect(txRepo.update).toHaveBeenCalled()
    })

    it('works without onReceiveCompleted (instant resolve)', async () => {
      const adapterWithoutCallback = createMockLightningAdapter({
        onReceiveCompleted: undefined,
      })
      const mod = createMockModule([adapterWithoutCallback])
      service = new SwapService([mod], txRepo, eventBus)

      const result = await service.executeSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(1000),
      })

      expect(result.ok).toBe(true)
    })
  })
})
