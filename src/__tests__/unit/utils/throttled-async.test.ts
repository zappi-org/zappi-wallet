import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createThrottledAsync } from '@/utils/throttled-async'

/**
 * Flush promise microtask queue.
 * vi.useFakeTimers에서도 동작하도록 queueMicrotask 사용.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise((r) => queueMicrotask(r))
}

describe('createThrottledAsync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('executes fn immediately on first trigger', () => {
    const fn = vi.fn().mockResolvedValue(undefined)
    const throttled = createThrottledAsync(fn)

    throttled.trigger()

    expect(fn).toHaveBeenCalledTimes(1)
    throttled.dispose()
  })

  it('does not call fn again while running', () => {
    let resolve: () => void
    const fn = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r }),
    )
    const throttled = createThrottledAsync(fn)

    throttled.trigger()
    throttled.trigger()
    throttled.trigger()

    expect(fn).toHaveBeenCalledTimes(1)

    resolve!()
    throttled.dispose()
  })

  it('executes once more after trailing delay when trailing flag is set', async () => {
    let resolve: () => void
    const fn = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r }),
    )
    const throttled = createThrottledAsync(fn, 150)

    throttled.trigger()
    throttled.trigger()
    expect(fn).toHaveBeenCalledTimes(1)

    resolve!()
    await flushMicrotasks()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(2)

    throttled.dispose()
  })

  it('trigger during trailing wait cancels timer and executes immediately', async () => {
    let resolve: () => void
    const fn = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r }),
    )
    const throttled = createThrottledAsync(fn, 150)

    throttled.trigger()         // 즉시 실행 (#1)
    throttled.trigger()         // trailing ON

    resolve!()
    await flushMicrotasks()     // trailing 타이머 시작

    vi.advanceTimersByTime(100) // 타이머 진행 중
    throttled.trigger()         // running=false → 즉시 실행 (#2), 타이머 취소

    expect(fn).toHaveBeenCalledTimes(2)

    // 원래 타이머 만료 시점 — 추가 실행 없음
    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(2)

    resolve!()
    throttled.dispose()
  })

  it('limits 50 triggers to at most 2 fn calls', async () => {
    let resolve: () => void
    const fn = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r }),
    )
    const throttled = createThrottledAsync(fn, 150)

    for (let i = 0; i < 50; i++) {
      throttled.trigger()
    }
    expect(fn).toHaveBeenCalledTimes(1)

    resolve!()
    await flushMicrotasks()

    vi.advanceTimersByTime(150)
    expect(fn).toHaveBeenCalledTimes(2)

    resolve!()
    await flushMicrotasks()
    vi.advanceTimersByTime(150)

    expect(fn).toHaveBeenCalledTimes(2)

    throttled.dispose()
  })

  it('cancels trailing timer on dispose', async () => {
    let resolve: () => void
    const fn = vi.fn().mockImplementation(
      () => new Promise<void>((r) => { resolve = r }),
    )
    const throttled = createThrottledAsync(fn, 150)

    throttled.trigger()
    throttled.trigger()

    resolve!()
    await flushMicrotasks()

    throttled.dispose()
    vi.advanceTimersByTime(150)

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('continues trailing after fn error', async () => {
    let callCount = 0
    const fn = vi.fn().mockImplementation(() => {
      callCount++
      if (callCount === 1) return Promise.reject(new Error('fail'))
      return Promise.resolve()
    })

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const throttled = createThrottledAsync(fn, 150)

    throttled.trigger()
    throttled.trigger()

    await flushMicrotasks()

    vi.advanceTimersByTime(150)
    expect(fn).toHaveBeenCalledTimes(2)

    consoleSpy.mockRestore()
    throttled.dispose()
  })
})
