/**
 * useAutoLock — idle auto-lock behavior (fixed 5-minute timeout, on/off flag).
 *
 * Key invariants:
 * - onLock fires after the fixed idle timeout when enabled
 * - user input resets the timer
 * - visibility return re-checks immediately — covers timers stopped by page freeze
 * - does nothing when already locked or disabled
 * - toggling enabled resets the idle baseline
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoLock } from '@/ui/hooks/use-auto-lock'

const MINUTE = 60_000

describe('useAutoLock', () => {
  let onLock: Mock<() => void>

  beforeEach(() => {
    vi.useFakeTimers()
    onLock = vi.fn<() => void>()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function render(over: Partial<Parameters<typeof useAutoLock>[0]> = {}) {
    return renderHook(
      (props: Parameters<typeof useAutoLock>[0]) => useAutoLock(props),
      {
        initialProps: {
          enabled: true,
          isLocked: false,
          onLock,
          ...over,
        },
      },
    )
  }

  it('locks after the fixed 5-minute idle timeout elapses', () => {
    render()

    act(() => { vi.advanceTimersByTime(5 * MINUTE + 15_000) })

    expect(onLock).toHaveBeenCalled()
  })

  it('user activity resets the idle clock', () => {
    render()

    // input at the 4-minute mark
    act(() => { vi.advanceTimersByTime(4 * MINUTE) })
    act(() => { window.dispatchEvent(new Event('pointerdown')) })

    // still not locked past the original 5-minute expiry
    act(() => { vi.advanceTimersByTime(2 * MINUTE) })
    expect(onLock).not.toHaveBeenCalled()

    // locks 5 minutes after the input
    act(() => { vi.advanceTimersByTime(3 * MINUTE + 15_000) })
    expect(onLock).toHaveBeenCalled()
  })

  it('re-checks immediately on visibility return (freeze mitigation)', () => {
    render()

    // simulate freeze: the interval stops, only the clock jumps
    act(() => { vi.setSystemTime(Date.now() + 10 * MINUTE) })
    expect(onLock).not.toHaveBeenCalled()

    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('does nothing when already locked', () => {
    const locked = render({ isLocked: true })
    act(() => { vi.advanceTimersByTime(60 * MINUTE) })
    expect(onLock).not.toHaveBeenCalled()
    locked.unmount()
  })

  it('does nothing when disabled — no timers, no listeners', () => {
    render({ enabled: false })

    act(() => { vi.advanceTimersByTime(60 * MINUTE) })
    expect(onLock).not.toHaveBeenCalled()

    // freeze-return path is inert too
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(onLock).not.toHaveBeenCalled()
  })

  it('enabling mid-session starts a fresh idle baseline', () => {
    const { rerender } = render({ enabled: false })

    act(() => { vi.advanceTimersByTime(60 * MINUTE) })
    expect(onLock).not.toHaveBeenCalled()

    // turning it on must not count prior idle time
    rerender({ enabled: true, isLocked: false, onLock })
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(onLock).not.toHaveBeenCalled()

    act(() => { vi.advanceTimersByTime(5 * MINUTE + 15_000) })
    expect(onLock).toHaveBeenCalled()
  })

  it('disabling mid-session releases the running timer', () => {
    const { rerender } = render()

    act(() => { vi.advanceTimersByTime(4 * MINUTE) })
    rerender({ enabled: false, isLocked: false, onLock })

    act(() => { vi.advanceTimersByTime(60 * MINUTE) })
    expect(onLock).not.toHaveBeenCalled()
  })

  it('unlock resets the baseline — prior session idle time does not trigger an immediate re-lock', () => {
    const { rerender } = render()

    act(() => { vi.advanceTimersByTime(5 * MINUTE + 15_000) })
    expect(onLock).toHaveBeenCalled()

    // switch to locked — listeners/timers released, no firing while locked
    rerender({ enabled: true, isLocked: true, onLock })
    onLock.mockClear()
    act(() => { vi.advanceTimersByTime(60 * MINUTE) })
    expect(onLock).not.toHaveBeenCalled()

    // unlock — recompute from the unlock moment, not prior idle time
    rerender({ enabled: true, isLocked: false, onLock })
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(onLock).not.toHaveBeenCalled()

    // locks again after another 5 minutes idle
    act(() => { vi.advanceTimersByTime(5 * MINUTE + 15_000) })
    expect(onLock).toHaveBeenCalled()
  })
})
