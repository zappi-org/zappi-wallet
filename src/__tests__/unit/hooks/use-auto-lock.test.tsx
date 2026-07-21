/**
 * useAutoLock — auto-lock behavior (always on) + grace heartbeat/clamp.
 *
 * Key invariants:
 * - onLock fires after timeoutMinutes of idle time
 * - user input resets the timer
 * - visibility return re-checks immediately — covers timers stopped by page freeze
 * - does nothing when already locked
 * - onExtendGrace fires at most once per activity burst (deterministic throttle)
 * - a timeout change re-clamps grace to now + new timeout immediately
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

  it('unlock resets the baseline — prior session idle time does not trigger an immediate re-lock', () => {
    const { rerender } = render()

    act(() => { vi.advanceTimersByTime(5 * MINUTE + 15_000) })
    expect(onLock).toHaveBeenCalled()

    // switch to locked — listeners/timers released, no firing while locked
    rerender({ timeoutMinutes: 5, isLocked: true, onLock })
    onLock.mockClear()
    act(() => { vi.advanceTimersByTime(60 * MINUTE) })
    expect(onLock).not.toHaveBeenCalled()

    // unlock — recompute from the unlock moment, not prior idle time
    rerender({ timeoutMinutes: 5, isLocked: false, onLock })
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(onLock).not.toHaveBeenCalled()

    // locks again after another 5 minutes idle
    act(() => { vi.advanceTimersByTime(5 * MINUTE + 15_000) })
    expect(onLock).toHaveBeenCalled()
  })

  // ─── grace heartbeat / clamp ───

  it('extends grace after activity, throttled to once per burst', () => {
    const onExtendGrace = vi.fn<(expiresAt: number) => void>()
    render({ onExtendGrace })

    // No activity yet → the first check does not extend
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(onExtendGrace).not.toHaveBeenCalled()

    // Activity advances the baseline; the next check extends to activity + timeout
    let activityAt = 0
    act(() => { window.dispatchEvent(new Event('pointerdown')); activityAt = Date.now() })
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(onExtendGrace).toHaveBeenCalledTimes(1)
    expect(onExtendGrace).toHaveBeenCalledWith(activityAt + 5 * MINUTE)

    // No new activity → next check does not re-extend (deterministic throttle)
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(onExtendGrace).toHaveBeenCalledTimes(1)
  })

  it('does not extend on the initial unlock (applyUnlock already saved grace)', () => {
    const onExtendGrace = vi.fn<(expiresAt: number) => void>()
    render({ onExtendGrace })
    // Mount alone (no activity, no timeout change) must not extend
    act(() => { vi.advanceTimersByTime(14_000) })
    expect(onExtendGrace).not.toHaveBeenCalled()
  })

  it('re-clamps grace to now + new timeout when the timeout changes', () => {
    const onExtendGrace = vi.fn<(expiresAt: number) => void>()
    const { rerender } = render({ timeoutMinutes: 5, onExtendGrace })

    expect(onExtendGrace).not.toHaveBeenCalled() // initial mount does not clamp

    // Shorten the timeout → immediate re-clamp to now + 1 minute
    const now = Date.now()
    rerender({ timeoutMinutes: 1, isLocked: false, onLock, onExtendGrace })
    expect(onExtendGrace).toHaveBeenCalledWith(now + 1 * MINUTE)
  })
})
