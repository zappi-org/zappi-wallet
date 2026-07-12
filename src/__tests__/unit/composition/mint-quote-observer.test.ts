/**
 * MintQuoteObserver — safety net for the Lightning-receive recording contract.
 *
 * This module is the only path that creates a transaction record when the mint
 * finalizes an invoice payment (mint-op:finalized). Pinned contract:
 * - Phase 5 path: if an OperationMap mapping exists, settle the existing pending
 *   TX (never create a new TX)
 * - idempotent: an already-settled/recorded quote returns false with no side effects
 * - on successful record: increment txRefreshTrigger + broadcast 'balance_changed'
 *   to other tabs
 * - swap quotes are skipped (SwapService records swap transactions separately)
 * - a recording failure never escapes the event handler (no unhandled rejection)
 *
 * To isolate module-global injected state (injectDependencies), beforeEach loads
 * one fresh module graph and shares it within that test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { OperationMap } from '@/core/ports/driven/operation-map.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { CashuRuntimeManager } from '@/modules/cashu/cashu-runtime'

const { legacyRepoMock, broadcastSyncMock } = vi.hoisted(() => ({
  legacyRepoMock: {
    findById: vi.fn(),
    save: vi.fn(),
  },
  broadcastSyncMock: vi.fn(),
}))

vi.mock('@/composition/legacy-transaction-repo', () => ({
  getTransactionRepo: () => legacyRepoMock,
}))
vi.mock('@/utils/cross-tab-sync', () => ({
  broadcastSync: broadcastSyncMock,
}))

let observer: typeof import('@/composition/mint-quote-observer')
let useAppStore: typeof import('@/store')['useAppStore']
let markQuoteAsSwap: typeof import('@/modules/cashu')['markQuoteAsSwap']
let unmarkQuoteAsSwap: typeof import('@/modules/cashu')['unmarkQuoteAsSwap']

beforeEach(async () => {
  vi.resetModules()
  observer = await import('@/composition/mint-quote-observer')
  ;({ useAppStore } = await import('@/store'))
  ;({ markQuoteAsSwap, unmarkQuoteAsSwap } = await import('@/modules/cashu'))

  legacyRepoMock.findById.mockReset().mockResolvedValue(null)
  legacyRepoMock.save.mockReset().mockResolvedValue(undefined)
  broadcastSyncMock.mockReset()
})

// resolvedTxId is required — prevents a default merge (??) from swallowing an intended null
function makeInjected(opts: {
  resolvedTxId: string | null
  existingTx?: Record<string, unknown> | null
}) {
  const opMap = {
    resolve: vi.fn().mockResolvedValue(opts.resolvedTxId),
    register: vi.fn(),
  } satisfies OperationMap
  const txRepo = {
    getById: vi.fn().mockResolvedValue(
      opts.existingTx === undefined
        ? { id: 'tx-mapped', status: 'pending', metadata: {} }
        : opts.existingTx,
    ),
    update: vi.fn().mockResolvedValue(undefined),
  }
  return { opMap, txRepo: txRepo as unknown as TransactionRepository, txRepoMock: txRepo }
}

const RECEIVE_PARAMS = {
  quoteId: 'quote-1',
  mintUrl: 'https://mint.example.com',
  amount: 21,
  bolt11: 'lnbc-req',
}

describe('recordLightningReceive', () => {
  it('Phase 5 path: settles the mapped pending TX and fires refresh + broadcast', async () => {
    const { opMap, txRepo, txRepoMock } = makeInjected({ resolvedTxId: 'tx-mapped' })
    observer.injectDependencies(opMap, txRepo)

    const before = useAppStore.getState().txRefreshTrigger
    const recorded = await observer.recordLightningReceive(RECEIVE_PARAMS)

    expect(recorded).toBe(true)
    expect(txRepoMock.update).toHaveBeenCalledWith(
      'tx-mapped',
      expect.objectContaining({
        status: 'settled',
        outcome: 'claimed',
        completedAt: expect.any(Number),
      }),
    )
    // the settle path never creates a new TX (double record = balance shown twice)
    expect(legacyRepoMock.save).not.toHaveBeenCalled()
    expect(useAppStore.getState().txRefreshTrigger).toBe(before + 1)
    expect(broadcastSyncMock).toHaveBeenCalledWith('balance_changed')
  })

  it('Phase 5 path: backfills bolt11 only on a TX that had none', async () => {
    const { opMap, txRepo, txRepoMock } = makeInjected({ resolvedTxId: 'tx-mapped' })
    observer.injectDependencies(opMap, txRepo)

    await observer.recordLightningReceive(RECEIVE_PARAMS)
    const updateArg = txRepoMock.update.mock.calls[0][1] as { metadata?: { bolt11?: string } }
    expect(updateArg.metadata?.bolt11).toBe('lnbc-req')
  })

  it('Phase 5 path: does not overwrite an existing metadata.bolt11', async () => {
    const { opMap, txRepo, txRepoMock } = makeInjected({
      resolvedTxId: 'tx-mapped',
      existingTx: { id: 'tx-mapped', status: 'pending', metadata: { bolt11: 'lnbc-original' } },
    })
    observer.injectDependencies(opMap, txRepo)

    await observer.recordLightningReceive(RECEIVE_PARAMS)
    const updateArg = txRepoMock.update.mock.calls[0][1] as { metadata?: unknown }
    expect(updateArg.metadata).toBeUndefined()
  })

  it('already-settled TX returns false — no re-record or re-fire (idempotent)', async () => {
    const { opMap, txRepo, txRepoMock } = makeInjected({
      resolvedTxId: 'tx-mapped',
      existingTx: { id: 'tx-mapped', status: 'settled', metadata: {} },
    })
    observer.injectDependencies(opMap, txRepo)

    const before = useAppStore.getState().txRefreshTrigger
    const recorded = await observer.recordLightningReceive(RECEIVE_PARAMS)

    expect(recorded).toBe(false)
    expect(txRepoMock.update).not.toHaveBeenCalled()
    expect(useAppStore.getState().txRefreshTrigger).toBe(before)
    expect(broadcastSyncMock).not.toHaveBeenCalled()
  })

  it('no mapping → fallback: creates a new TX as tx-{quoteId} in the legacy repo', async () => {
    const { opMap, txRepo } = makeInjected({ resolvedTxId: null })
    observer.injectDependencies(opMap, txRepo)

    const before = useAppStore.getState().txRefreshTrigger
    const recorded = await observer.recordLightningReceive(RECEIVE_PARAMS)

    expect(recorded).toBe(true)
    expect(legacyRepoMock.save).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'tx-quote-1',
        direction: 'receive',
        type: 'lightning',
        amount: 21,
        mintUrl: 'https://mint.example.com',
        status: 'completed',
        metadata: { quoteId: 'quote-1' },
      }),
    )
    expect(useAppStore.getState().txRefreshTrigger).toBe(before + 1)
    expect(broadcastSyncMock).toHaveBeenCalledWith('balance_changed')
  })

  it('with no injection at all (transitional) goes straight to the fallback path', async () => {
    const recorded = await observer.recordLightningReceive(RECEIVE_PARAMS)
    expect(recorded).toBe(true)
    expect(legacyRepoMock.save).toHaveBeenCalled()
  })

  it('fallback is idempotent too: returns false with no side effects when tx-{quoteId} exists', async () => {
    legacyRepoMock.findById.mockResolvedValue({ id: 'tx-quote-1' })

    const recorded = await observer.recordLightningReceive(RECEIVE_PARAMS)

    expect(recorded).toBe(false)
    expect(legacyRepoMock.save).not.toHaveBeenCalled()
    expect(broadcastSyncMock).not.toHaveBeenCalled()
  })
})

describe('connectMintQuoteObserver', () => {
  type FinalizedHandler = (event: {
    operation: { state: string; quoteId: string; amount: number; request?: string }
    mintUrl: string
  }) => Promise<void>

  function makeManager() {
    const handlers: Record<string, FinalizedHandler> = {}
    const unsub = vi.fn()
    const manager = {
      on: vi.fn((event: string, handler: FinalizedHandler) => {
        handlers[event] = handler
        return unsub
      }),
    }
    return { manager: manager as unknown as CashuRuntimeManager, handlers, unsub }
  }

  it('finalized event → records the transaction (fallback path)', async () => {
    const { manager, handlers } = makeManager()
    observer.connectMintQuoteObserver(manager)

    await handlers['mint-op:finalized']({
      operation: { state: 'finalized', quoteId: 'quote-live', amount: 5, request: 'lnbc-x' },
      mintUrl: 'https://mint.example.com',
    })

    expect(legacyRepoMock.save).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tx-quote-live', amount: 5 }),
    )
  })

  it('does not record a swap quote (SwapService records it separately — prevents double recording)', async () => {
    const { manager, handlers } = makeManager()
    observer.connectMintQuoteObserver(manager)

    markQuoteAsSwap('quote-swap')
    try {
      await handlers['mint-op:finalized']({
        operation: { state: 'finalized', quoteId: 'quote-swap', amount: 5 },
        mintUrl: 'https://mint.example.com',
      })
      expect(legacyRepoMock.save).not.toHaveBeenCalled()
    } finally {
      unmarkQuoteAsSwap('quote-swap')
    }
  })

  it('ignores non-finalized states', async () => {
    const { manager, handlers } = makeManager()
    observer.connectMintQuoteObserver(manager)

    await handlers['mint-op:finalized']({
      operation: { state: 'pending', quoteId: 'quote-p', amount: 5 },
      mintUrl: 'https://mint.example.com',
    })

    expect(legacyRepoMock.save).not.toHaveBeenCalled()
  })

  it('a recording failure is swallowed inside the handler (no unhandled rejection)', async () => {
    const { manager, handlers } = makeManager()
    observer.connectMintQuoteObserver(manager)

    legacyRepoMock.save.mockRejectedValue(new Error('db down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(
        handlers['mint-op:finalized']({
          operation: { state: 'finalized', quoteId: 'quote-err', amount: 5 },
          mintUrl: 'https://mint.example.com',
        }),
      ).resolves.toBeUndefined()
      expect(errorSpy).toHaveBeenCalledWith(
        '[MintQuoteObserver] Failed to record transaction:',
        expect.any(Error),
      )
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('disconnect releases the subscription; re-calling connect releases the old one and re-subscribes', async () => {
    const { manager, unsub } = makeManager()

    observer.connectMintQuoteObserver(manager)
    observer.connectMintQuoteObserver(manager) // reconnect — releases the previous subscription
    expect(unsub).toHaveBeenCalledTimes(1)

    observer.disconnectMintQuoteObserver()
    expect(unsub).toHaveBeenCalledTimes(2)
  })
})
