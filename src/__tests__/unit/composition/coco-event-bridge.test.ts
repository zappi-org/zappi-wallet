/**
 * CocoEventBridge — contract safety net for SDK → domain event translation.
 *
 * This bridge is the sole SDK-side origin of balance:changed. Pinned contracts:
 * - proofs:* (4 kinds) / mint-op:finalized / melt-quote:paid → balance:changed
 * - mint-op:finalized(finalized) → receive:settled (+isSwapStep flag)
 * - one initial balance:changed on connect (shows balance right after bootstrap)
 * - all subscriptions released on disconnect
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { connectCocoEventBridge } from '@/composition/coco-event-bridge'
import { markQuoteAsSwap, unmarkQuoteAsSwap } from '@/modules/cashu'
import type { CashuRuntimeManager } from '@/modules/cashu/cashu-runtime'
import type { EventBus } from '@/core/events/event-bus'

type Handler = (event: unknown) => void

function makeManager() {
  const handlers: Record<string, Handler> = {}
  const unsubs: ReturnType<typeof vi.fn>[] = []
  const manager = {
    on: vi.fn((event: string, handler: Handler) => {
      handlers[event] = handler
      const unsub = vi.fn()
      unsubs.push(unsub)
      return unsub
    }),
  }
  return { manager: manager as unknown as CashuRuntimeManager, handlers, unsubs }
}

describe('CocoEventBridge', () => {
  let emit: ReturnType<typeof vi.fn>
  let eventBus: EventBus

  beforeEach(() => {
    emit = vi.fn()
    eventBus = { emit } as unknown as EventBus
  })

  function balanceChangedCount(): number {
    return emit.mock.calls.filter(([e]) => e.type === 'balance:changed').length
  }

  it('emits an initial balance:changed once on connect', () => {
    const { manager } = makeManager()
    connectCocoEventBridge(manager, eventBus)
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith({
      type: 'balance:changed',
      payload: { moduleId: 'cashu', accountId: '' },
    })
  })

  it.each(['proofs:saved', 'proofs:state-changed', 'proofs:deleted', 'proofs:wiped'])(
    '%s → balance:changed',
    (event) => {
      const { manager, handlers } = makeManager()
      connectCocoEventBridge(manager, eventBus)
      emit.mockClear()

      handlers[event]({})
      expect(balanceChangedCount()).toBe(1)
    },
  )

  it('melt-quote:paid → balance:changed', () => {
    const { manager, handlers } = makeManager()
    connectCocoEventBridge(manager, eventBus)
    emit.mockClear()

    handlers['melt-quote:paid']({})
    expect(balanceChangedCount()).toBe(1)
  })

  it('mint-op:finalized(finalized) → balance:changed + receive:settled', () => {
    const { manager, handlers } = makeManager()
    connectCocoEventBridge(manager, eventBus)
    emit.mockClear()

    handlers['mint-op:finalized']({
      operation: { state: 'finalized', quoteId: 'quote-1', amount: 21 },
      mintUrl: 'https://mint.example.com',
    })

    expect(balanceChangedCount()).toBe(1)
    expect(emit).toHaveBeenCalledWith({
      type: 'receive:settled',
      payload: {
        requestId: 'quote-1',
        amount: 21,
        accountId: 'https://mint.example.com',
        method: 'bolt11',
        isSwapStep: false,
      },
    })
  })

  it('swap quote is flagged isSwapStep=true on receive:settled', () => {
    const { manager, handlers } = makeManager()
    connectCocoEventBridge(manager, eventBus)
    emit.mockClear()

    markQuoteAsSwap('quote-swap')
    try {
      handlers['mint-op:finalized']({
        operation: { state: 'finalized', quoteId: 'quote-swap', amount: 21 },
        mintUrl: 'https://mint.example.com',
      })
      const settled = emit.mock.calls.find(([e]) => e.type === 'receive:settled')?.[0]
      expect(settled?.payload.isSwapStep).toBe(true)
    } finally {
      unmarkQuoteAsSwap('quote-swap')
    }
  })

  it('non-finalized mint-op emits balance:changed only (no receive:settled)', () => {
    const { manager, handlers } = makeManager()
    connectCocoEventBridge(manager, eventBus)
    emit.mockClear()

    handlers['mint-op:finalized']({
      operation: { state: 'pending', quoteId: 'quote-p', amount: 21 },
      mintUrl: 'https://mint.example.com',
    })

    expect(balanceChangedCount()).toBe(1)
    expect(emit.mock.calls.some(([e]) => e.type === 'receive:settled')).toBe(false)
  })

  it('releases all 6 subscriptions (proofs 4 + mint-op + melt) on disconnect', () => {
    const { manager, unsubs } = makeManager()
    const disconnect = connectCocoEventBridge(manager, eventBus)

    disconnect()

    expect(unsubs).toHaveLength(6)
    for (const unsub of unsubs) {
      expect(unsub).toHaveBeenCalledTimes(1)
    }
  })
})
