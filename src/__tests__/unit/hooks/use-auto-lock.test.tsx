/**
 * useAutoLock — auto-lock behavior.
 *
 * Key invariants:
 * - onLock fires after timeoutMinutes of idle time
 * - user input resets the timer
 * - visibility return re-checks immediately — covers timers stopped by page freeze
 * - does nothing when disabled or already locked
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoLock } from '@/ui/hooks/use-auto-lock'

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
          timeoutMinutes: 5,
          isLocked: false,
          onLock,
          ...over,
        },
      },
    )
  }

  it('locks after the idle timeout elapses', () => {
    render()

    act(() => { vi.advanceTimersByTime(5 * 60_000 + 15_000) })

    expect(onLock).toHaveBeenCalled()
  })

  it('user activity resets the idle clock', () => {
    render()

    // input at the 4-minute mark
    act(() => { vi.advanceTimersByTime(4 * 60_000) })
    act(() => { window.dispatchEvent(new Event('pointerdown')) })

    // still not locked past the original 5-minute expiry
    act(() => { vi.advanceTimersByTime(2 * 60_000) })
    expect(onLock).not.toHaveBeenCalled()

    // locks 5 minutes after the input
    act(() => { vi.advanceTimersByTime(3 * 60_000 + 15_000) })
    expect(onLock).toHaveBeenCalled()
  })

  it('re-checks immediately on visibility return (freeze mitigation)', () => {
    render()

    // simulate freeze: the interval stops, only the clock jumps
    act(() => { vi.setSystemTime(Date.now() + 10 * 60_000) })
    expect(onLock).not.toHaveBeenCalled()

    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it('does nothing when disabled or already locked', () => {
    const disabled = render({ enabled: false })
    act(() => { vi.advanceTimersByTime(60 * 60_000) })
    expect(onLock).not.toHaveBeenCalled()
    disabled.unmount()

    const locked = render({ isLocked: true })
    act(() => { vi.advanceTimersByTime(60 * 60_000) })
    expect(onLock).not.toHaveBeenCalled()
    locked.unmount()
  })

  it('unlock resets the baseline — prior session idle time does not trigger an immediate re-lock', () => {
    const { rerender } = render()

    act(() => { vi.advanceTimersByTime(5 * 60_000 + 15_000) })
    expect(onLock).toHaveBeenCalled()

    // switch to locked — listeners/timers released, no firing while locked
    rerender({ enabled: true, timeoutMinutes: 5, isLocked: true, onLock })
    onLock.mockClear()
    act(() => { vi.advanceTimersByTime(60 * 60_000) })
    expect(onLock).not.toHaveBeenCalled()

    // unlock — recompute from the unlock moment, not prior idle time
    rerender({ enabled: true, timeoutMinutes: 5, isLocked: false, onLock })
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(onLock).not.toHaveBeenCalled()

    // locks again after another 5 minutes idle
    act(() => { vi.advanceTimersByTime(5 * 60_000 + 15_000) })
    expect(onLock).toHaveBeenCalled()
  })
})
