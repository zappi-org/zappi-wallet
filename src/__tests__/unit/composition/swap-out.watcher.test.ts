import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEventBus } from '@/core/events/event-bus'
import type { SwapOutUseCase, SwapOutView } from '@/core/ports/driving/swap-out.usecase'
import { SwapOutWatcher } from '@/composition/swap-out.watcher'

function view(patch: Partial<SwapOutView> = {}): SwapOutView {
  return {
    id: 'payout-1',
    mintUrl: 'https://mint.example.com',
    offerId: 'fake:offer-1',
    identifier: 'npub1fake',
    destination: 'bcrt1qdestination',
    sendAmount: 100000,
    receiveAmount: 99000,
    stage: 'paying',
    phase: 'submitted',
    payoutTxId: null,
    failureReason: null,
    hasOpenPayments: true,
    deadline: { blockHeight: 209, estimatedAt: 0 },
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function createService(active: SwapOutView[] = [view()]) {
  const resumeAll = vi.fn().mockResolvedValue(undefined)
  const listActive = vi.fn().mockResolvedValue(active)
  const service = { resumeAll, listActive } as unknown as SwapOutUseCase
  return { service, resumeAll, listActive }
}

describe('SwapOutWatcher', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resumes once on start and keeps polling while payouts are active', async () => {
    const active = createService([view()])
    const eventBus = createEventBus()
    const watcher = new SwapOutWatcher({
      service: active.service,
      eventBus,
      pollIntervalMs: 1000,
    })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(active.resumeAll).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(active.resumeAll).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1000)
    expect(active.resumeAll).toHaveBeenCalledTimes(3)
    watcher.stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(active.resumeAll).toHaveBeenCalledTimes(3)
  })

  it('stops polling when nothing is active', async () => {
    const idle = createService([])
    const watcher = new SwapOutWatcher({
      service: idle.service,
      eventBus: createEventBus(),
      pollIntervalMs: 1000,
    })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(idle.resumeAll).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5000)
    expect(idle.resumeAll).toHaveBeenCalledTimes(1)
    watcher.stop()
  })

  it('re-arms on a non-terminal update and ignores terminal ones', async () => {
    const idle = createService([])
    const eventBus = createEventBus()
    const watcher = new SwapOutWatcher({
      service: idle.service,
      eventBus,
      pollIntervalMs: 1000,
    })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)

    eventBus.emit({ type: 'swap-out:updated', payload: view({ stage: 'completed' }) })
    await vi.advanceTimersByTimeAsync(5000)
    expect(idle.resumeAll).toHaveBeenCalledTimes(1)

    eventBus.emit({ type: 'swap-out:updated', payload: view({ stage: 'sweeping' }) })
    await vi.advanceTimersByTimeAsync(1000)
    expect(idle.resumeAll).toHaveBeenCalledTimes(2)
    watcher.stop()
  })

  it('runs resumeAll on app resume and ignores it before start', async () => {
    const active = createService([view()])
    const watcher = new SwapOutWatcher({
      service: active.service,
      eventBus: createEventBus(),
      pollIntervalMs: 1000,
    })
    await watcher.resume()
    expect(active.resumeAll).not.toHaveBeenCalled()

    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await watcher.resume()
    expect(active.resumeAll).toHaveBeenCalledTimes(2)
    watcher.stop()
  })

  it('refreshes the in-flight amount on every poll', async () => {
    const active = createService([view()])
    const refreshInFlight = vi.fn().mockResolvedValue(undefined)
    const watcher = new SwapOutWatcher({
      service: active.service,
      eventBus: createEventBus(),
      pollIntervalMs: 1000,
      refreshInFlight,
    })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(refreshInFlight).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(1000)
    expect(refreshInFlight).toHaveBeenCalledTimes(2)
    watcher.stop()
  })

  it('keeps polling when the in-flight refresh fails', async () => {
    const active = createService([view()])
    const refreshInFlight = vi.fn().mockRejectedValue(new Error('store down'))
    const warn = vi.fn()
    const watcher = new SwapOutWatcher({
      service: active.service,
      eventBus: createEventBus(),
      pollIntervalMs: 1000,
      refreshInFlight,
      logger: { warn },
    })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(active.resumeAll).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalled()
    watcher.stop()
  })

  it('catches errors and keeps polling', async () => {
    const active = createService([view()])
    active.resumeAll.mockRejectedValueOnce(new Error('boom'))
    const warn = vi.fn()
    const watcher = new SwapOutWatcher({
      service: active.service,
      eventBus: createEventBus(),
      pollIntervalMs: 1000,
      logger: { warn },
    })
    await expect(watcher.resume()).resolves.toBeUndefined()
    watcher.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(warn).toHaveBeenCalled()
    watcher.stop()
  })

  it('unsubscribes from updates on stop', async () => {
    const idle = createService([])
    const eventBus = createEventBus()
    const watcher = new SwapOutWatcher({
      service: idle.service,
      eventBus,
      pollIntervalMs: 1000,
    })
    watcher.start()
    await vi.advanceTimersByTimeAsync(0)
    watcher.stop()
    eventBus.emit({ type: 'swap-out:updated', payload: view({ stage: 'funded' }) })
    await vi.advanceTimersByTimeAsync(5000)
    expect(idle.resumeAll).toHaveBeenCalledTimes(1)
  })
})
