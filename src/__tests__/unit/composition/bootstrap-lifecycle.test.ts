import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLifecycle } from '@/composition/bootstrap-lifecycle'

const runtime = vi.hoisted(() => ({
  getCashuRuntimeManager: vi.fn(),
  resumeCashuSubscriptions: vi.fn(),
  enableCashuWatchers: vi.fn(),
  pauseCashuSubscriptions: vi.fn(),
  recheckCashuPendingMintQuotes: vi.fn(),
}))
vi.mock('@/modules/cashu/cashu-runtime', () => runtime)
vi.mock('@/adapters/telemetry/net-counters', () => ({
  startNetCounterFlusher: vi.fn(() => vi.fn()), flushNetCounters: vi.fn(),
}))
vi.mock('@/composition/exchange-rate', () => ({
  exchangeRateService: { refreshIfStale: vi.fn().mockResolvedValue(undefined) },
}))

function harness() {
  const watcher = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn(), waitForIdle: vi.fn().mockResolvedValue(undefined) }
  const incoming = { start: vi.fn(), stop: vi.fn() }
  const transfers = { stopPolling: vi.fn(), stopStuckSweep: vi.fn(), startPolling: vi.fn(), startStuckSweep: vi.fn() }
  const gateway = { disconnect: vi.fn().mockResolvedValue(undefined) }
  const lifecycle = createLifecycle({
    nostrPrivateKeyHex: '1'.repeat(64), killSwitches: {},
    getNpubcashWatcher: () => watcher, getNostrIncomingWatcher: () => incoming,
    transferLifecycle: transfers, nostrGateway: gateway,
  } as unknown as Parameters<typeof createLifecycle>[0])
  return { lifecycle, watcher, incoming, transfers }
}

afterEach(() => { vi.clearAllMocks() })

describe('lifecycle disposal', () => {
  it('does not reactivate after an outstanding runtime lookup finishes', async () => {
    let finish!: () => void
    runtime.getCashuRuntimeManager.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({}) }))
    const h = harness()
    const activation = h.lifecycle.activate()
    await h.lifecycle.dispose()
    finish()
    await activation
    await h.lifecycle.onResume()
    expect(h.watcher.start).not.toHaveBeenCalled()
    expect(h.incoming.start).not.toHaveBeenCalled()
    expect(runtime.enableCashuWatchers).not.toHaveBeenCalled()
  })

  it('does not restart other watchers when a resume finishes after disposal', async () => {
    let finish!: () => void
    runtime.resumeCashuSubscriptions.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    const h = harness()
    const resume = h.lifecycle.onResume()
    expect(h.watcher.start).toHaveBeenCalledTimes(1)
    await h.lifecycle.dispose()
    finish()
    await resume
    expect(h.watcher.start).toHaveBeenCalledTimes(1)
    expect(h.incoming.start).not.toHaveBeenCalled()
    expect(h.transfers.startStuckSweep).not.toHaveBeenCalled()
    expect(runtime.enableCashuWatchers).not.toHaveBeenCalled()
  })
})
