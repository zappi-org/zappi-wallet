import { describe, it, expect, vi } from 'vitest'
import { createNut18HttpPollerFactory } from '@/composition/nut18-poller-factory'
import type { startNut18HttpPoller } from '@/adapters/codec/nut18-http-poller'

type StartFn = typeof startNut18HttpPoller

function createStartSpy() {
  const handle = {
    cancel: vi.fn(),
    onPayment: vi.fn(),
    onError: vi.fn(),
  }
  const start = vi.fn<StartFn>(() => handle)
  return { start, handle }
}

describe('createNut18HttpPollerFactory', () => {
  /**
   * Core regression guard — full snapshot of the wiring fields.
   * A past inline bootstrap factory dropped expiresAt, so 3s polling ran for
   * up to 30 min after expiry. Update this test whenever a field is added.
   */
  it('forwards EVERY poller option — expiresAt included', () => {
    const { start } = createStartSpy()
    const factory = createNut18HttpPollerFactory(start)

    factory({
      endpoint: 'https://mint.example/pr/abc',
      requestId: 'req-1',
      intervalMs: 3_000,
      maxDurationMs: 60_000,
      expiresAt: 1_751_400_000_000,
    })

    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({
      endpoint: 'https://mint.example/pr/abc',
      requestId: 'req-1',
      intervalMs: 3_000,
      maxDurationMs: 60_000,
      expiresAt: 1_751_400_000_000,
    })
  })

  it('forwards optional fields as undefined when omitted (poller defaults apply)', () => {
    const { start } = createStartSpy()
    const factory = createNut18HttpPollerFactory(start)

    factory({ endpoint: 'https://mint.example/pr/abc', requestId: 'req-2' })

    expect(start).toHaveBeenCalledWith({
      endpoint: 'https://mint.example/pr/abc',
      requestId: 'req-2',
      intervalMs: undefined,
      maxDurationMs: undefined,
      expiresAt: undefined,
    })
  })

  it('maps the poller handle onto the Poller port (stop=cancel)', () => {
    const { start, handle } = createStartSpy()
    const factory = createNut18HttpPollerFactory(start)

    const poller = factory({ endpoint: 'e', requestId: 'r' })
    poller.stop()
    expect(handle.cancel).toHaveBeenCalledTimes(1)

    const onPayment = vi.fn()
    poller.onPayment(onPayment)
    expect(handle.onPayment).toHaveBeenCalledWith(onPayment)

    const onError = vi.fn()
    poller.onError(onError)
    expect(handle.onError).toHaveBeenCalledWith(onError)
  })
})
