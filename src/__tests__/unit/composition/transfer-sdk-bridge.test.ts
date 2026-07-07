/**
 * Transfer SDK Bridge — Coco push events → TLS state transitions.
 *
 * The melt-op:finalized / melt-op:rolled-back bridges are a prerequisite for
 * replacing the unlock-time melt refresh loop with reconcile: without this push
 * path, a melt failure in a live session wouldn't reach the UI until the next unlock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  connectTransferSdkBridge,
  disconnectTransferSdkBridge,
} from '@/composition/transfer-sdk-bridge'
import { markQuoteAsSwap, unmarkQuoteAsSwap } from '@/modules/cashu/internal/swap-quote-tracker'
import type { CashuRuntimeManager } from '@/modules/cashu/cashu-runtime'
import type { TransferLifecycleService } from '@/core/services/transfer-lifecycle.service'

type Handler = (payload: Record<string, unknown>) => Promise<void> | void

function makeManager() {
  const handlers = new Map<string, Handler>()
  const unsubs = new Map<string, ReturnType<typeof vi.fn>>()
  const manager = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, handler)
      const unsub = vi.fn()
      unsubs.set(event, unsub)
      return unsub
    }),
  } as unknown as CashuRuntimeManager
  return { manager, handlers, unsubs }
}

function makeLifecycle() {
  return {
    resolveByOperationRef: vi.fn().mockResolvedValue(true),
  } as unknown as TransferLifecycleService & {
    resolveByOperationRef: ReturnType<typeof vi.fn>
  }
}

describe('connectTransferSdkBridge', () => {
  beforeEach(() => {
    disconnectTransferSdkBridge()
  })

  it('subscribes to all six lifecycle events', () => {
    const { manager, handlers } = makeManager()
    connectTransferSdkBridge(manager, makeLifecycle())

    expect([...handlers.keys()].sort()).toEqual([
      'melt-op:finalized',
      'melt-op:rolled-back',
      'melt-quote:paid',
      'mint-op:finalized',
      'send:finalized',
      'send:rolled-back',
    ])
  })

  it('melt-op:finalized resolves the transfer as settled (paid redundancy)', async () => {
    const { manager, handlers } = makeManager()
    const lifecycle = makeLifecycle()
    connectTransferSdkBridge(manager, lifecycle)

    await handlers.get('melt-op:finalized')!({ operationId: 'op-1' })

    expect(lifecycle.resolveByOperationRef).toHaveBeenCalledWith('op-1', 'settled')
  })

  it('melt-op:rolled-back resolves the transfer as failed (live-failure delivery path)', async () => {
    const { manager, handlers } = makeManager()
    const lifecycle = makeLifecycle()
    connectTransferSdkBridge(manager, lifecycle)

    await handlers.get('melt-op:rolled-back')!({ operationId: 'op-2' })

    expect(lifecycle.resolveByOperationRef).toHaveBeenCalledWith('op-2', 'failed')
  })

  it('swallows a resolve exception so the event pipeline is not killed', async () => {
    const { manager, handlers } = makeManager()
    const lifecycle = makeLifecycle()
    lifecycle.resolveByOperationRef.mockRejectedValue(new Error('db down'))
    connectTransferSdkBridge(manager, lifecycle)

    await expect(
      handlers.get('melt-op:rolled-back')!({ operationId: 'op-3' }),
    ).resolves.toBeUndefined()
  })

  it('mint-op:finalized ignores internal swap finalizations', async () => {
    const { manager, handlers } = makeManager()
    const lifecycle = makeLifecycle()
    connectTransferSdkBridge(manager, lifecycle)

    markQuoteAsSwap('swap-quote-1')
    try {
      await handlers.get('mint-op:finalized')!({
        operation: { quoteId: 'swap-quote-1' },
      })
    } finally {
      unmarkQuoteAsSwap('swap-quote-1')
    }

    expect(lifecycle.resolveByOperationRef).not.toHaveBeenCalled()
  })

  it('disconnect unsubscribes every handler', () => {
    const { manager, unsubs } = makeManager()
    const stop = connectTransferSdkBridge(manager, makeLifecycle())

    stop()

    for (const unsub of unsubs.values()) {
      expect(unsub).toHaveBeenCalledTimes(1)
    }
  })
})
