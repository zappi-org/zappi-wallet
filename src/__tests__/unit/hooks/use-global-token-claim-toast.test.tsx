import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createEventBus, type EventBus } from '@/core/events/event-bus'
import { sat } from '@/core/domain/amount'
import type { PendingTransfer } from '@/core/domain/pending-transfer'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { useGlobalTokenClaimToast } from '@/ui/hooks/use-global-token-claim-toast'
import {
  markPaymentOwnedByUI,
  unmarkPaymentOwnedByUI,
} from '@/ui/utils/payment-event-consumers'

// t echoes key + interpolations so we can assert amount/memo made it through.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      `${key}|${opts?.amount ?? ''}|${opts?.memo ?? ''}`,
  }),
}))
vi.mock('@/utils/format', () => ({
  useFormatSats: () => (n: number) => `${n}`,
}))
const addToast = vi.fn()
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: { addToast: typeof addToast }) => unknown) =>
    selector({ addToast }),
}))
vi.mock('@/ui/utils/haptic', () => ({ hapticSuccess: vi.fn() }))

function makeRegistry(eventBus: EventBus): ServiceRegistry {
  return { eventBus } as unknown as ServiceRegistry
}

function outgoingTransfer(
  txId: string,
  opts: { type: string; amount?: number; memo?: string } = { type: 'ecash-token' },
): PendingTransfer {
  return {
    id: `pt-${txId}`,
    txId,
    direction: 'outgoing',
    phase: 'settled',
    finality: 'deferred',
    onExpiry: 'reclaim',
    transportRef: { type: opts.type, amount: opts.amount, memo: opts.memo },
    createdAt: 0,
    updatedAt: 0,
  } as PendingTransfer
}

describe('useGlobalTokenClaimToast', () => {
  let eventBus: EventBus

  beforeEach(() => {
    addToast.mockClear()
    eventBus = createEventBus()
    unmarkPaymentOwnedByUI('tx-1')
  })

  it('send:claimed first, then transfer:settled → exactly one toast', () => {
    renderHook(() => useGlobalTokenClaimToast(makeRegistry(eventBus)))

    eventBus.emit({
      type: 'send:claimed',
      payload: { txId: 'tx-1', method: 'ecash', protocol: 'cashu-token', amount: sat(500), memo: 'lunch' },
    })
    eventBus.emit({
      type: 'transfer:settled',
      payload: { transfer: outgoingTransfer('tx-1', { type: 'ecash-token', amount: 500, memo: 'lunch' }) },
    })

    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'toast.tokenClaimedWithMemo|500|lunch' }),
    )
  })

  it('transfer:settled first, then send:claimed → exactly one toast', () => {
    renderHook(() => useGlobalTokenClaimToast(makeRegistry(eventBus)))

    eventBus.emit({
      type: 'transfer:settled',
      payload: { transfer: outgoingTransfer('tx-1', { type: 'ecash-token', amount: 500, memo: 'lunch' }) },
    })
    eventBus.emit({
      type: 'send:claimed',
      payload: { txId: 'tx-1', method: 'ecash', protocol: 'cashu-token', amount: sat(500), memo: 'lunch' },
    })

    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'toast.tokenClaimedWithMemo|500|lunch' }),
    )
  })

  it('transfer:settled alone (NEW path wins) → one toast from transfer payload', () => {
    renderHook(() => useGlobalTokenClaimToast(makeRegistry(eventBus)))

    eventBus.emit({
      type: 'transfer:settled',
      payload: { transfer: outgoingTransfer('tx-1', { type: 'ecash-token', amount: 700 }) },
    })

    expect(addToast).toHaveBeenCalledTimes(1)
    expect(addToast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success', message: 'toast.tokenClaimed|700|' }),
    )
  })

  it('isPaymentOwnedByUI true → suppressed on BOTH paths', () => {
    markPaymentOwnedByUI('tx-1')
    renderHook(() => useGlobalTokenClaimToast(makeRegistry(eventBus)))

    eventBus.emit({
      type: 'send:claimed',
      payload: { txId: 'tx-1', method: 'ecash', protocol: 'cashu-token', amount: sat(500) },
    })
    eventBus.emit({
      type: 'transfer:settled',
      payload: { transfer: outgoingTransfer('tx-1', { type: 'ecash-token', amount: 500 }) },
    })

    expect(addToast).not.toHaveBeenCalled()
  })

  it('bolt11 outgoing transfer:settled → no specific token-claim toast', () => {
    renderHook(() => useGlobalTokenClaimToast(makeRegistry(eventBus)))

    eventBus.emit({
      type: 'transfer:settled',
      payload: { transfer: outgoingTransfer('tx-1', { type: 'bolt11-melt', amount: 500 }) },
    })

    expect(addToast).not.toHaveBeenCalled()
  })
})
