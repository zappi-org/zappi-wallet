/**
 * LockScreen lockout 계수 계약 (R2-B 형제 버그 수정의 보안 속성 고정)
 *
 * 핀 대상:
 * - onUnlock resolve(false) = PIN 불일치 → 계수 (wrongPin + 초과 시 lockout 기록)
 * - onUnlock reject = 인프라 실패 → errorOccurred 표시, **계수·lockout 기록 없음**
 *   (구버전은 모든 실패가 false 라 일시적 IDB 장애로 정당 사용자가
 *   브루트포스 방어 15분 잠금에 갇혔다)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const stableT = (key: string, opts?: Record<string, unknown>) => {
  if (opts && typeof opts === 'object') {
    let out = key
    for (const [k, v] of Object.entries(opts)) {
      out = out.replace(`{{${k}}}`, String(v))
    }
    return out
  }
  return key
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: stableT, i18n: { language: 'en' } }),
}))

// LockScreen 은 common barrel 에서 CountdownTimer 만 쓰는데, barrel 이
// QRCodeDisplay→bc-ur→cborg(exports 맵 비호환)까지 끌고 온다 — 필요분만 스텁
vi.mock('@/ui/components/common', () => ({
  CountdownTimer: () => null,
}))

import { LockScreen } from '@/ui/screens/Lock/LockScreen'

async function typePin(digits: string) {
  for (const d of digits) {
    // NumericKeypad 는 onPointerDown 으로 입력을 받는다
    fireEvent.pointerDown(screen.getByRole('button', { name: d }))
  }
}

describe('LockScreen lockout 계수 계약', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('PIN 불일치(resolve false) → 계수: wrongPin 표시 + 잔여 횟수', async () => {
    const onUnlock = vi.fn().mockResolvedValue(false)
    render(<LockScreen onUnlock={onUnlock} maxAttempts={5} />)

    await typePin('111111')
    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith('111111'))

    // remaining = 5-1 = 4 로 보간된 wrongPin
    await screen.findByText('lock.wrongPin')
    expect(localStorage.getItem('lockout')).toBeNull() // 아직 임계 미만 — 기록 없음
  })

  it('인프라 실패(reject) → errorOccurred 표시, 계수·lockout 기록 없음', async () => {
    const onUnlock = vi.fn().mockRejectedValue(new Error('storage down'))
    render(<LockScreen onUnlock={onUnlock} maxAttempts={2} lockoutDurationMinutes={15} />)

    // maxAttempts=2 인데 인프라 실패를 3번 겪어도 잠기지 않아야 한다
    for (let i = 0; i < 3; i += 1) {
      await typePin('222222')
      await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(i + 1))
      await screen.findByText('lock.errorOccurred')
    }

    expect(localStorage.getItem('lockout')).toBeNull()
    expect(screen.queryByText(/lock.lockedOut/)).toBeNull()
  })

  it('PIN 불일치가 임계에 도달하면 lockout 기록 (브루트포스 방어는 그대로)', async () => {
    const onUnlock = vi.fn().mockResolvedValue(false)
    render(<LockScreen onUnlock={onUnlock} maxAttempts={2} lockoutDurationMinutes={15} />)

    await typePin('333333')
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1))
    await typePin('444444')
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(2))

    await waitFor(() => {
      const stored = localStorage.getItem('lockout')
      expect(stored).not.toBeNull()
      expect(JSON.parse(stored!).attempts).toBe(2)
    })
  })
})
