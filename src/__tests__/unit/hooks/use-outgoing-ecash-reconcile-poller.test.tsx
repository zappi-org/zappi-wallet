import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ServiceRegistry } from '@/core/ports/driving/service-registry'
import { useOutgoingEcashReconcilePoller } from '@/ui/hooks/use-outgoing-ecash-reconcile-poller'

describe('useOutgoingEcashReconcilePoller', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setVisibility('visible')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('polls open outgoing ecash while enabled, visible, and online', async () => {
    const reconcileOpen = vi.fn().mockResolvedValue({ checked: 1, claimed: 1, failed: 0 })
    renderHook(() => useOutgoingEcashReconcilePoller({
      registry: makeRegistry(reconcileOpen),
      enabled: true,
      isOnline: true,
      cashuInitPromiseRef: { current: Promise.resolve() },
      intervalMs: 1000,
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(reconcileOpen).toHaveBeenCalledOnce()
  })

  it('does not poll while offline or hidden', async () => {
    const reconcileOpen = vi.fn().mockResolvedValue({ checked: 0, claimed: 0, failed: 0 })
    renderHook(() => useOutgoingEcashReconcilePoller({
      registry: makeRegistry(reconcileOpen),
      enabled: true,
      isOnline: false,
      cashuInitPromiseRef: { current: Promise.resolve() },
      intervalMs: 1000,
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(reconcileOpen).not.toHaveBeenCalled()

    setVisibility('hidden')
    renderHook(() => useOutgoingEcashReconcilePoller({
      registry: makeRegistry(reconcileOpen),
      enabled: true,
      isOnline: true,
      cashuInitPromiseRef: { current: Promise.resolve() },
      intervalMs: 1000,
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(reconcileOpen).not.toHaveBeenCalled()
  })

  it('checks immediately when the app becomes visible again', async () => {
    setVisibility('hidden')
    const reconcileOpen = vi.fn().mockResolvedValue({ checked: 1, claimed: 0, failed: 0 })
    renderHook(() => useOutgoingEcashReconcilePoller({
      registry: makeRegistry(reconcileOpen),
      enabled: true,
      isOnline: true,
      cashuInitPromiseRef: { current: Promise.resolve() },
      intervalMs: 1000,
    }))

    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    expect(reconcileOpen).toHaveBeenCalledOnce()
  })

  it('does not run overlapping reconcile checks', async () => {
    let release!: () => void
    const pending = new Promise<void>((resolve) => {
      release = resolve
    })
    const reconcileOpen = vi.fn().mockReturnValue(pending)
    renderHook(() => useOutgoingEcashReconcilePoller({
      registry: makeRegistry(reconcileOpen),
      enabled: true,
      isOnline: true,
      cashuInitPromiseRef: { current: Promise.resolve() },
      intervalMs: 1000,
    }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(reconcileOpen).toHaveBeenCalledOnce()

    await act(async () => {
      release()
      await pending
      await vi.advanceTimersByTimeAsync(1000)
    })

    expect(reconcileOpen).toHaveBeenCalledTimes(2)
  })
})

function makeRegistry(reconcileOpen: ReturnType<typeof vi.fn>): Pick<ServiceRegistry, 'outgoingEcashLifecycle'> {
  return {
    outgoingEcashLifecycle: {
      reconcileOpen,
    } as unknown as ServiceRegistry['outgoingEcashLifecycle'],
  }
}

function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  })
}
