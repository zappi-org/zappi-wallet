/**
 * useAutoLock — 자동잠금 실구현 (감사 §6: 설정만 있고 소비자가 없던 결함)
 *
 * 핵심 불변식:
 * - 유휴 timeoutMinutes 경과 시 onLock 발화
 * - 사용자 입력이 타이머를 리셋
 * - 화면 복귀(visibilitychange) 순간 즉시 재판정 — freeze로 멈춘 타이머 보완
 * - 비활성/이미 잠김이면 아무 것도 안 함
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

    // 4분 경과 시점에 입력 발생
    act(() => { vi.advanceTimersByTime(4 * 60_000) })
    act(() => { window.dispatchEvent(new Event('pointerdown')) })

    // 원래 만료 시점(5분)을 지나도 잠기지 않는다
    act(() => { vi.advanceTimersByTime(2 * 60_000) })
    expect(onLock).not.toHaveBeenCalled()

    // 입력으로부터 5분이 지나면 잠긴다
    act(() => { vi.advanceTimersByTime(3 * 60_000 + 15_000) })
    expect(onLock).toHaveBeenCalled()
  })

  it('re-checks immediately on visibility return (freeze 보완)', () => {
    render()

    // freeze 시뮬레이션: 인터벌은 안 돌고 시계만 점프
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

  it('unlock resets the baseline — 이전 세션 유휴 시간이 즉시 재잠금을 만들지 않는다', () => {
    const { rerender } = render()

    act(() => { vi.advanceTimersByTime(5 * 60_000 + 15_000) })
    expect(onLock).toHaveBeenCalled()

    // 잠금 상태로 전환 — 리스너/타이머 해제, 잠금 중에는 발화 없음
    rerender({ enabled: true, timeoutMinutes: 5, isLocked: true, onLock })
    onLock.mockClear()
    act(() => { vi.advanceTimersByTime(60 * 60_000) })
    expect(onLock).not.toHaveBeenCalled()

    // 해제 — 이전 유휴 시간이 아니라 해제 시점부터 다시 계산
    rerender({ enabled: true, timeoutMinutes: 5, isLocked: false, onLock })
    act(() => { vi.advanceTimersByTime(15_000) })
    expect(onLock).not.toHaveBeenCalled()

    // 다시 유휴 5분이 지나면 잠긴다
    act(() => { vi.advanceTimersByTime(5 * 60_000 + 15_000) })
    expect(onLock).toHaveBeenCalled()
  })
})
