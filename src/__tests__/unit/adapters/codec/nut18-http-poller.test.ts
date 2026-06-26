/**
 * NUT-18 HTTP Poller — self-stop on local expiry
 *
 * Verifies that when `expiresAt` is provided and the wall clock passes it,
 * the poller cancels itself without making further requests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { startNut18HttpPoller } from '@/adapters/codec/nut18-http-poller'

describe('startNut18HttpPoller — expiry self-stop', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.useFakeTimers()
    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('does not fetch once Date.now() exceeds expiresAt', async () => {
    const start = 1_700_000_000_000
    vi.setSystemTime(start)

    const poller = startNut18HttpPoller({
      endpoint: 'https://mint.test/v1/payment-request/abc',
      requestId: 'req-1',
      intervalMs: 1000,
      expiresAt: start + 3_000,
    })

    // Initial poll + 3 interval ticks (t=1s, 2s, 3s) — all within window.
    // At t=3s, Date.now() === expiresAt (not >), so it still fetches.
    await vi.advanceTimersByTimeAsync(3_000)
    expect(fetchSpy).toHaveBeenCalledTimes(4)

    // Next tick at t=4s — Date.now() > expiresAt, must NOT fetch and
    // the poller must cancel itself.
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchSpy).toHaveBeenCalledTimes(4)

    // Advance well beyond — still no further fetches.
    await vi.advanceTimersByTimeAsync(60_000)
    expect(fetchSpy).toHaveBeenCalledTimes(4)

    poller.cancel()
  })

  it('keeps polling when expiresAt is in the future', async () => {
    const start = 1_700_000_000_000
    vi.setSystemTime(start)

    const poller = startNut18HttpPoller({
      endpoint: 'https://mint.test/v1/payment-request/abc',
      requestId: 'req-2',
      intervalMs: 1000,
      expiresAt: start + 60_000,
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchSpy).toHaveBeenCalledTimes(6)

    poller.cancel()
  })

  it('behaves like before when expiresAt is omitted (backward compatible)', async () => {
    const start = 1_700_000_000_000
    vi.setSystemTime(start)

    const poller = startNut18HttpPoller({
      endpoint: 'https://mint.test/v1/payment-request/abc',
      requestId: 'req-3',
      intervalMs: 1000,
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(10_000)
    // Initial + 10 ticks
    expect(fetchSpy).toHaveBeenCalledTimes(11)

    poller.cancel()
  })
})
