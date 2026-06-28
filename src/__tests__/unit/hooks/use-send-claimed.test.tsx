import type { ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { createEventBus } from '@/core/events/event-bus'
import { sat } from '@/core/domain/amount'
import type { PendingTransfer, TransferDirection } from '@/core/domain/pending-transfer'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { ServiceProvider } from '@/ui/hooks/service-context'
import { useSendClaimed } from '@/ui/hooks/use-send-claimed'

function makeRegistry() {
  return {
    eventBus: createEventBus(),
  } as unknown as ServiceRegistry
}

function makeTransfer(txId: string, direction: TransferDirection): PendingTransfer {
  return {
    id: `transfer-${txId}`,
    txId,
    direction,
    phase: 'settled',
    finality: 'revocable',
    onExpiry: 'reclaim',
    transportRef: { protocol: 'ecash' },
    createdAt: 1,
    updatedAt: 2,
    amount: 100,
  }
}

describe('useSendClaimed', () => {
  it('fires for legacy send:claimed events', () => {
    const registry = makeRegistry()
    const callback = vi.fn()

    renderHook(() => useSendClaimed('tx-1', callback), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ServiceProvider registry={registry}>{children}</ServiceProvider>
      ),
    })

    act(() => {
      registry.eventBus.emit({
        type: 'send:claimed',
        payload: {
          txId: 'tx-1',
          method: 'cashu:ecash',
          protocol: 'cashu-token',
          amount: sat(100),
        },
      })
    })

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('fires for outgoing TLS transfer:settled events with the same txId', () => {
    const registry = makeRegistry()
    const callback = vi.fn()

    renderHook(() => useSendClaimed('tx-1', callback), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <ServiceProvider registry={registry}>{children}</ServiceProvider>
      ),
    })

    act(() => {
      registry.eventBus.emit({
        type: 'transfer:settled',
        payload: { transfer: makeTransfer('tx-other', 'outgoing') },
      })
      registry.eventBus.emit({
        type: 'transfer:settled',
        payload: { transfer: makeTransfer('tx-1', 'incoming') },
      })
      registry.eventBus.emit({
        type: 'transfer:settled',
        payload: { transfer: makeTransfer('tx-1', 'outgoing') },
      })
    })

    expect(callback).toHaveBeenCalledTimes(1)
  })
})
