import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SwapService } from '@/core/services/swap.service'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { PaymentMethodAdapter } from '@/core/ports/driven/payment-method.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import type { SwapQuoteMarker } from '@/core/ports/driven/swap-quote-marker.port'
import { sat, toNumber } from '@/core/domain/amount'

// ─── Mocks ───

type MockSwapQuoteMarker = SwapQuoteMarker & {
  abandon: ReturnType<typeof vi.fn>
}

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
      id: 'quote-1', method: 'bolt11', protocol: 'bolt11',
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
    recoverAccount: vi.fn().mockResolvedValue(undefined),
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

function createMockSwapQuoteMarker(): MockSwapQuoteMarker {
  return {
    mark: vi.fn(),
    unmark: vi.fn(),
    abandon: vi.fn().mockResolvedValue(undefined),
  }
}

describe('SwapService', () => {
  let service: SwapService
  let adapter: PaymentMethodAdapter
  let txRepo: TransactionRepository
  let eventBus: EventBus
  let quoteMarker: MockSwapQuoteMarker

  beforeEach(() => {
    adapter = createMockLightningAdapter()
    const module = createMockModule([adapter])
    txRepo = createMockTxRepo()
    eventBus = createMockEventBus()
    quoteMarker = createMockSwapQuoteMarker()
    service = new SwapService([module], txRepo, eventBus, quoteMarker)
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
      expect(quoteMarker.abandon).toHaveBeenCalledWith('https://mint-b.test', 'quote-1')
    })

    it('abandons the temporary quote if fee estimation fails', async () => {
      vi.mocked(adapter.estimateFee).mockRejectedValueOnce(new Error('fee estimate failed'))

      const result = await service.estimateSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(1000),
      })

      expect(result.ok).toBe(false)
      expect(quoteMarker.abandon).toHaveBeenCalledWith('https://mint-b.test', 'quote-1')
    })

    it('keeps the temporary quote id visible when estimate cleanup fails', async () => {
      vi.mocked(adapter.estimateFee).mockRejectedValueOnce(new Error('fee estimate failed'))
      quoteMarker.abandon.mockRejectedValueOnce(new Error('cleanup failed'))

      const result = await service.estimateSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(1000),
      })

      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(result.error.message).toBe('fee estimate failed (cleanup failed for quote quote-1: cleanup failed)')
      expect(quoteMarker.abandon).toHaveBeenCalledWith('https://mint-b.test', 'quote-1')
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
      expect(result.error.code).toBe('UNKNOWN')

      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'swap:failed' }),
      )
      // Failed transactions should be updated
      expect(txRepo.update).toHaveBeenCalled()
    })

    it('preserves the original error when cleanup also fails before send execution', async () => {
      const unsubscribe = vi.fn()
      const failingAdapter = createMockLightningAdapter({
        prepareSend: vi.fn().mockRejectedValue(new Error('prepare failed')),
        onReceiveCompleted: vi.fn().mockImplementation(() => unsubscribe),
      })
      quoteMarker.abandon.mockRejectedValue(new Error('cleanup failed'))
      const mod = createMockModule([failingAdapter])
      service = new SwapService([mod], txRepo, eventBus, quoteMarker)

      const result = await service.executeSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(1000),
      })

      expect(result.ok).toBe(false)
      if (result.ok) return

      expect(result.error.code).toBe('UNKNOWN')
      expect(result.error.message).toBe('prepare failed (cleanup failed: cleanup failed)')
      expect(quoteMarker.mark).toHaveBeenCalledWith('quote-1')
      expect(quoteMarker.abandon).toHaveBeenCalledWith('https://mint-b.test', 'quote-1')
      expect(quoteMarker.unmark).toHaveBeenCalledWith('quote-1')
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'swap:failed',
          payload: expect.objectContaining({ error: 'prepare failed (cleanup failed: cleanup failed)' }),
        }),
      )
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('works without onReceiveCompleted (instant resolve)', async () => {
      const adapterWithoutCallback = createMockLightningAdapter({
        onReceiveCompleted: undefined,
      })
      const mod = createMockModule([adapterWithoutCallback])
      service = new SwapService([mod], txRepo, eventBus, quoteMarker)

      const result = await service.executeSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(1000),
      })

      expect(result.ok).toBe(true)
    })

    it('treats drain amount as the fee-inclusive budget', async () => {
      const unsubscribeFirst = vi.fn()
      const unsubscribeSecond = vi.fn()
      const drainAdapter = createMockLightningAdapter({
        createReceiveRequest: vi.fn()
          .mockResolvedValueOnce({
            id: 'quote-1', method: 'bolt11', protocol: 'bolt11',
            encoded: 'lnbc100n1...', amount: sat(100),
          })
          .mockResolvedValueOnce({
            id: 'quote-2', method: 'bolt11', protocol: 'bolt11',
            encoded: 'lnbc95n1...', amount: sat(95),
          }),
        prepareSend: vi.fn()
          .mockResolvedValueOnce({
            id: 'melt-1', method: 'lightning', protocol: 'bolt11',
            amount: sat(100), fee: sat(5),
          })
          .mockResolvedValueOnce({
            id: 'melt-2', method: 'lightning', protocol: 'bolt11',
            amount: sat(95), fee: sat(1),
          }),
        onReceiveCompleted: vi.fn()
          .mockImplementationOnce(() => unsubscribeFirst)
          .mockImplementationOnce((_requestId, handler) => {
            setTimeout(() => handler({ requestId: 'quote-2', amount: sat(95), completedAt: Date.now() }), 0)
            return unsubscribeSecond
          }),
      })
      const mod = createMockModule([drainAdapter])
      vi.mocked(mod.getBalance).mockResolvedValue({
        moduleId: 'cashu',
        accounts: [{ id: 'https://mint-a.test', label: 'mint-a', amount: sat(9999) }],
        total: sat(9999),
      })
      service = new SwapService([mod], txRepo, eventBus, quoteMarker)

      const result = await service.executeSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(100),
        drain: true,
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return

      expect(result.value.amount).toEqual(sat(95))
      expect(drainAdapter.cancelPrepared).toHaveBeenCalledWith('melt-1')
      expect(drainAdapter.createReceiveRequest).toHaveBeenNthCalledWith(2, {
        amount: sat(95),
        accountId: 'https://mint-b.test',
      })
      expect(mod.getBalance).not.toHaveBeenCalled()
      expect(quoteMarker.mark).toHaveBeenNthCalledWith(1, 'quote-1')
      expect(quoteMarker.abandon).toHaveBeenCalledWith('https://mint-b.test', 'quote-1')
      expect(quoteMarker.unmark).toHaveBeenNthCalledWith(1, 'quote-1')
      expect(quoteMarker.mark).toHaveBeenNthCalledWith(2, 'quote-2')
      expect(quoteMarker.unmark).toHaveBeenNthCalledWith(2, 'quote-2')
      const abandonMock = vi.mocked(quoteMarker.abandon)
      const unmarkMock = vi.mocked(quoteMarker.unmark)
      expect(abandonMock.mock.invocationCallOrder[0]).toBeLessThan(
        unmarkMock.mock.invocationCallOrder[0],
      )
      expect(unmarkMock.mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(drainAdapter.createReceiveRequest).mock.invocationCallOrder[1],
      )
      expect(unsubscribeFirst).toHaveBeenCalledTimes(1)
      expect(unsubscribeSecond).toHaveBeenCalledTimes(1)
    })

    it('abandons the current drain quote before returning an early budget failure', async () => {
      const unsubscribe = vi.fn()
      const drainAdapter = createMockLightningAdapter({
        createReceiveRequest: vi.fn().mockResolvedValue({
          id: 'quote-1', method: 'bolt11', protocol: 'bolt11',
          encoded: 'lnbc100n1...', amount: sat(100),
        }),
        prepareSend: vi.fn().mockResolvedValue({
          id: 'melt-1', method: 'lightning', protocol: 'bolt11',
          amount: sat(100), fee: sat(100),
        }),
        onReceiveCompleted: vi.fn().mockImplementation(() => unsubscribe),
      })
      const mod = createMockModule([drainAdapter])
      service = new SwapService([mod], txRepo, eventBus, quoteMarker)

      const result = await service.executeSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(100),
        drain: true,
      })

      expect(result.ok).toBe(false)
      if (result.ok) return

      expect(result.error.code).toBe('INSUFFICIENT_BALANCE')
      expect(drainAdapter.cancelPrepared).toHaveBeenCalledWith('melt-1')
      expect(quoteMarker.unmark).toHaveBeenCalledWith('quote-1')
      expect(quoteMarker.abandon).toHaveBeenCalledWith('https://mint-b.test', 'quote-1')
      expect(unsubscribe).toHaveBeenCalledTimes(1)
      expect(drainAdapter.executeSend).not.toHaveBeenCalled()
      expect(txRepo.save).not.toHaveBeenCalled()
    })

    it('preserves the early drain failure reason when cleanup also fails', async () => {
      const unsubscribe = vi.fn()
      const drainAdapter = createMockLightningAdapter({
        createReceiveRequest: vi.fn().mockResolvedValue({
          id: 'quote-1', method: 'bolt11', protocol: 'bolt11',
          encoded: 'lnbc100n1...', amount: sat(100),
        }),
        prepareSend: vi.fn().mockResolvedValue({
          id: 'melt-1', method: 'lightning', protocol: 'bolt11',
          amount: sat(100), fee: sat(100),
        }),
        onReceiveCompleted: vi.fn().mockImplementation(() => unsubscribe),
      })
      quoteMarker.abandon.mockRejectedValue(new Error('cleanup failed'))
      const mod = createMockModule([drainAdapter])
      service = new SwapService([mod], txRepo, eventBus, quoteMarker)

      const result = await service.executeSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(100),
        drain: true,
      })

      expect(result.ok).toBe(false)
      if (result.ok) return

      expect(result.error.code).toBe('INSUFFICIENT_BALANCE')
      expect(result.error.message).toBe('Insufficient balance for fee: required 0 + fee 100, available 0')
      expect(quoteMarker.abandon).toHaveBeenCalledWith('https://mint-b.test', 'quote-1')
      expect(quoteMarker.unmark).toHaveBeenCalledWith('quote-1')
      expect(drainAdapter.executeSend).not.toHaveBeenCalled()
      expect(txRepo.save).not.toHaveBeenCalled()
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('fails the drain retry when abandoning the old quote cleanup fails', async () => {
      const unsubscribe = vi.fn()
      const drainAdapter = createMockLightningAdapter({
        createReceiveRequest: vi.fn().mockResolvedValue({
          id: 'quote-1', method: 'bolt11', protocol: 'bolt11',
          encoded: 'lnbc100n1...', amount: sat(100),
        }),
        prepareSend: vi.fn().mockResolvedValue({
          id: 'melt-1', method: 'lightning', protocol: 'bolt11',
          amount: sat(100), fee: sat(5),
        }),
        onReceiveCompleted: vi.fn().mockImplementation(() => unsubscribe),
      })
      quoteMarker.abandon.mockRejectedValue(new Error('cleanup failed'))
      const mod = createMockModule([drainAdapter])
      service = new SwapService([mod], txRepo, eventBus, quoteMarker)

      const result = await service.executeSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(100),
        drain: true,
      })

      expect(result.ok).toBe(false)
      if (result.ok) return

      expect(result.error.code).toBe('UNKNOWN')
      expect(result.error.message).toBe('cleanup failed')
      expect(drainAdapter.cancelPrepared).toHaveBeenCalledWith('melt-1')
      expect(quoteMarker.mark).toHaveBeenCalledTimes(1)
      expect(quoteMarker.abandon).toHaveBeenCalledTimes(1)
      expect(quoteMarker.abandon).toHaveBeenCalledWith('https://mint-b.test', 'quote-1')
      expect(quoteMarker.unmark).toHaveBeenCalledWith('quote-1')
      expect(vi.mocked(drainAdapter.createReceiveRequest)).toHaveBeenCalledTimes(1)
      expect(drainAdapter.executeSend).not.toHaveBeenCalled()
      expect(txRepo.save).not.toHaveBeenCalled()
      expect(eventBus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'swap:failed' }),
      )
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('cleans up the replacement quote when a later drain retry step fails before send execution', async () => {
      const unsubscribeFirst = vi.fn()
      const unsubscribeSecond = vi.fn()
      const drainAdapter = createMockLightningAdapter({
        createReceiveRequest: vi.fn()
          .mockResolvedValueOnce({
            id: 'quote-1', method: 'bolt11', protocol: 'bolt11',
            encoded: 'lnbc100n1...', amount: sat(100),
          })
          .mockResolvedValueOnce({
            id: 'quote-2', method: 'bolt11', protocol: 'bolt11',
            encoded: 'lnbc95n1...', amount: sat(95),
          }),
        prepareSend: vi.fn()
          .mockResolvedValueOnce({
            id: 'melt-1', method: 'lightning', protocol: 'bolt11',
            amount: sat(100), fee: sat(5),
          })
          .mockRejectedValueOnce(new Error('prepare second failed')),
        onReceiveCompleted: vi.fn()
          .mockImplementationOnce(() => unsubscribeFirst)
          .mockImplementationOnce(() => unsubscribeSecond),
      })
      const mod = createMockModule([drainAdapter])
      service = new SwapService([mod], txRepo, eventBus, quoteMarker)

      const result = await service.executeSwap({
        sourceAccountId: 'https://mint-a.test',
        targetAccountId: 'https://mint-b.test',
        amount: sat(100),
        drain: true,
      })

      expect(result.ok).toBe(false)
      if (result.ok) return

      expect(result.error.code).toBe('UNKNOWN')
      expect(result.error.message).toBe('prepare second failed')
      expect(quoteMarker.abandon).toHaveBeenNthCalledWith(1, 'https://mint-b.test', 'quote-1')
      expect(quoteMarker.abandon).toHaveBeenNthCalledWith(2, 'https://mint-b.test', 'quote-2')
      expect(quoteMarker.unmark).toHaveBeenNthCalledWith(1, 'quote-1')
      expect(quoteMarker.unmark).toHaveBeenNthCalledWith(2, 'quote-2')
      expect(unsubscribeFirst).toHaveBeenCalledTimes(1)
      expect(unsubscribeSecond).toHaveBeenCalledTimes(1)
      expect(drainAdapter.executeSend).not.toHaveBeenCalled()
      expect(txRepo.save).not.toHaveBeenCalled()
    })
  })
})
