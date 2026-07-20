import { describe, expect, it, vi } from 'vitest'
import { PaymentRoute, type RouteSelection } from '@/core/domain/routing'
import type { EventBus } from '@/core/events/event-bus'
import type { PaymentDeliveryPort } from '@/core/ports/driven/payment-delivery.port'
import type { RouteExecutionStore } from '@/core/ports/driven/route-execution-store.port'
import type { RoutePaymentOperator } from '@/core/ports/driven/route-payment-operator.port'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import { RouteExecutionService } from '@/core/services/route-execution.service'
import { TransferLifecycleService } from '@/core/services/transfer-lifecycle.service'

function createSelection(overrides?: Partial<RouteSelection>): RouteSelection {
  return {
    route: PaymentRoute.TOKEN_TRANSFER,
    amount: 100,
    sourceMintUrl: 'https://mint-a.test',
    targetMintUrl: 'https://mint-a.test',
    estimatedFee: 2,
    reason: 'Token transfer',
    ...overrides,
  }
}

describe('RouteExecutionService', () => {
  it('creates a reusable invoice from resolved LNURL pay parameters before fee quoting', async () => {
    const fetchInvoice = vi.fn().mockResolvedValue({ bolt11: 'lnbc100n1resolved' })
    const service = new RouteExecutionService(
      {} as RoutePaymentOperator,
      {} as TransactionRepository,
      {} as RouteExecutionStore,
      {} as PaymentDeliveryPort,
      {} as TokenCodec,
      { fetchInvoice } as never,
      { emit: vi.fn() } as unknown as EventBus,
      {} as TransferLifecycleService,
    )
    const lnurlPayParams = {
      callback: 'https://example.com/pay',
      minSendable: 1000,
      maxSendable: 1000000,
      metadata: '[["text/plain","Alice"]]',
      tag: 'payRequest' as const,
      domain: 'example.com',
    }

    const result = await service.resolveInvoice(
      createSelection({ route: PaymentRoute.MELT_TO_LN, targetMintUrl: undefined }),
      { lnurlPayParams },
    )

    expect(result).toEqual({ ok: true, value: 'lnbc100n1resolved' })
    expect(fetchInvoice).toHaveBeenCalledWith(lnurlPayParams, 100)
  })

  it('executes token delivery through ports and records a pending send transaction', async () => {
    const operator = {
      prepareTokenSend: vi.fn().mockResolvedValue({ operationId: 'op-send', fee: 2 }),
      executeTokenSend: vi.fn().mockResolvedValue({ token: 'cashuAtoken' }),
      rollbackTokenSend: vi.fn(),
      createMintQuote: vi.fn(),
      markMintQuoteAsSwap: vi.fn(),
      unmarkMintQuoteAsSwap: vi.fn(),
      prepareMelt: vi.fn(),
      executeMelt: vi.fn(),
      rollbackMelt: vi.fn(),
      redeemMintQuote: vi.fn(),
    } as unknown as RoutePaymentOperator
    const txRepo = { save: vi.fn() } as unknown as TransactionRepository
    const routeStore = {
      savePendingSendToken: vi.fn(),
      savePendingMelt: vi.fn(),
      deletePendingMelt: vi.fn(),
    } as unknown as RouteExecutionStore
    const delivery: PaymentDeliveryPort = {
      deliverToken: vi.fn().mockResolvedValue({ success: true, transportUsed: 'nostr' }),
    }
    const eventBus = { emit: vi.fn() } as unknown as EventBus
    const syncNotifier = { notifyBalanceChanged: vi.fn() }
    const transferLifecycle = {
      initiateTransfer: vi.fn(),
    } as unknown as TransferLifecycleService
    const service = new RouteExecutionService(
      operator,
      txRepo,
      routeStore,
      delivery,
      {} as TokenCodec,
      {} as never,
      eventBus,
      transferLifecycle,
      syncNotifier,
    )

    const result = await service.executeRoute(createSelection(), {
      parsedCreq: {
        id: 'direct-1',
        unit: 'sat',
        mints: ['https://mint-a.test'],
        transports: [{ type: 'nostr', target: 'npub1recipient' }],
        hasNostrTransport: true,
        nostrTarget: 'npub1recipient',
        hasPostTransport: false,
        p2pkPubkey: '02abc',
        sameMintOnly: true,
      },
      memo: 'hello',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(operator.prepareTokenSend).toHaveBeenCalledWith({
      mintUrl: 'https://mint-a.test',
      amount: 100,
    })
    expect(operator.executeTokenSend).toHaveBeenCalledWith('op-send', { memo: 'hello' })
    expect(txRepo.save).toHaveBeenCalledWith(expect.objectContaining({
      direction: 'send',
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      accountId: 'https://mint-a.test',
      outcome: 'unclaimed',
      intent: 'request-pay',
    }))
    expect(routeStore.savePendingSendToken).toHaveBeenCalledWith(expect.objectContaining({
      token: 'cashuAtoken',
      operationId: 'op-send',
    }))
    expect(delivery.deliverToken).toHaveBeenCalledWith(expect.objectContaining({
      token: 'cashuAtoken',
      memo: 'hello',
    }))
    expect(syncNotifier.notifyBalanceChanged).toHaveBeenCalledOnce()
    expect(result.value.transportUsed).toBe('nostr')
  })

  it('executes bolt11 send via TransferLifecycleService', async () => {
    const mockTransferLifecycle = {
      initiateTransfer: vi.fn().mockResolvedValue({
        id: 'transfer-1',
        txId: 'tx-bolt11-1',
        phase: 'settled',
        direction: 'outgoing',
        transportRef: {
          feeReserve: 150,
          effectiveFee: 120,
        },
      }),
    }

    const operator = {
      prepareTokenSend: vi.fn(),
      executeTokenSend: vi.fn(),
      rollbackTokenSend: vi.fn(),
      createMintQuote: vi.fn(),
      markMintQuoteAsSwap: vi.fn(),
      unmarkMintQuoteAsSwap: vi.fn(),
      prepareMelt: vi.fn(),
      executeMelt: vi.fn(),
      rollbackMelt: vi.fn(),
      redeemMintQuote: vi.fn(),
    } as unknown as RoutePaymentOperator

    const txRepo = { save: vi.fn() } as unknown as TransactionRepository
    const routeStore = {
      savePendingSendToken: vi.fn(),
      savePendingMelt: vi.fn(),
      deletePendingMelt: vi.fn(),
    } as unknown as RouteExecutionStore
    const delivery: PaymentDeliveryPort = {
      deliverToken: vi.fn(),
    }
    const eventBus = { emit: vi.fn() } as unknown as EventBus
    const syncNotifier = { notifyBalanceChanged: vi.fn() }

    const service = new RouteExecutionService(
      operator,
      txRepo,
      routeStore,
      delivery,
      {
        isBolt11: vi.fn().mockReturnValue(true),
        decodeBolt11: vi.fn().mockReturnValue({ isExpired: false }),
      } as unknown as TokenCodec,
      {} as never,
      eventBus,
      mockTransferLifecycle as unknown as import('@/core/services/transfer-lifecycle.service').TransferLifecycleService,
      syncNotifier,
    )

    const result = await service.executeRoute(
      createSelection({
        route: PaymentRoute.MELT_TO_LN,
        invoice: 'lnbc100n1p3...',
      }),
      {},
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(mockTransferLifecycle.initiateTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        txId: expect.stringMatching(/^tx-/),
        accountId: 'https://mint-a.test',
        amount: expect.objectContaining({ unit: 'sat' }),
        recipient: 'lnbc100n1p3...',
      }),
      'bolt11',
    )
    expect(result.value.status).toBe('settled')
    expect(result.value.transactionId).toBe('tx-bolt11-1')
    expect(result.value.fee).toBe(120)
    expect(result.value.amount).toBe(100)
    expect(result.value.sourceMintUrl).toBe('https://mint-a.test')
  })

  it('reports an in_transit melt as in_transit, never as failure', async () => {
    // A retry on a false "failure" would prepare a second melt for the same
    // invoice — the double-pay window this status exists to close.
    const mockTransferLifecycle = {
      initiateTransfer: vi.fn().mockResolvedValue({
        id: 'transfer-2',
        txId: 'tx-bolt11-2',
        phase: 'in_transit',
        direction: 'outgoing',
        transportRef: { feeReserve: 150 },
      }),
    }

    const service = new RouteExecutionService(
      {} as unknown as RoutePaymentOperator,
      { save: vi.fn() } as unknown as TransactionRepository,
      {
        savePendingSendToken: vi.fn(),
        savePendingMelt: vi.fn(),
        deletePendingMelt: vi.fn(),
      } as unknown as RouteExecutionStore,
      { deliverToken: vi.fn() } as PaymentDeliveryPort,
      {
        isBolt11: vi.fn().mockReturnValue(true),
        decodeBolt11: vi.fn().mockReturnValue({ isExpired: false }),
      } as unknown as TokenCodec,
      {} as never,
      { emit: vi.fn() } as unknown as EventBus,
      mockTransferLifecycle as unknown as import('@/core/services/transfer-lifecycle.service').TransferLifecycleService,
      { notifyBalanceChanged: vi.fn() },
    )

    const result = await service.executeRoute(
      createSelection({
        route: PaymentRoute.MELT_TO_LN,
        invoice: 'lnbc100n1p3...',
      }),
      {},
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe('in_transit')
    expect(result.value.fee).toBe(150)
  })
})
