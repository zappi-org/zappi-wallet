import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { onWake } from '@/core/utils/wake-signal'

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('onWake', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'visible',
    })
  })

  it('collapses a burst of online/visibility events into a single callback', () => {
    const cb = vi.fn()
    const cleanup = onWake(cb, { debounceMs: 3_000 })

    window.dispatchEvent(new Event('online'))
    setVisibility('visible')
    window.dispatchEvent(new Event('online'))

    expect(cb).not.toHaveBeenCalled()
    vi.advanceTimersByTime(3_000)
    expect(cb).toHaveBeenCalledTimes(1)

    cleanup()
  })

  it('resets the debounce window on each trigger (trailing)', () => {
    const cb = vi.fn()
    const cleanup = onWake(cb, { debounceMs: 3_000 })

    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(2_000)
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(2_000)
    expect(cb).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1_000)
    expect(cb).toHaveBeenCalledTimes(1)

    cleanup()
  })

  it('ignores visibilitychange to hidden', () => {
    const cb = vi.fn()
    const cleanup = onWake(cb, { debounceMs: 1_000 })

    setVisibility('hidden')
    vi.advanceTimersByTime(1_000)
    expect(cb).not.toHaveBeenCalled()

    cleanup()
  })

  it('cleanup removes listeners and cancels the pending timer', () => {
    const cb = vi.fn()
    const cleanup = onWake(cb, { debounceMs: 1_000 })

    window.dispatchEvent(new Event('online'))
    cleanup()
    vi.advanceTimersByTime(1_000)
    expect(cb).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(1_000)
    expect(cb).not.toHaveBeenCalled()
  })

  it('fires again for a wake after a completed cycle', () => {
    const cb = vi.fn()
    const cleanup = onWake(cb, { debounceMs: 1_000 })

    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(1_000)
    window.dispatchEvent(new Event('online'))
    vi.advanceTimersByTime(1_000)

    expect(cb).toHaveBeenCalledTimes(2)
    cleanup()
  })
})
