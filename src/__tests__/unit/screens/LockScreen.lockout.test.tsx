/**
 * LockScreen lockout-counting contract.
 *
 * Pinned:
 * - onUnlock resolve(false) = wrong PIN → count (wrongPin + record lockout when exceeded)
 * - onUnlock reject = infra failure → show errorOccurred, **no counting or lockout record**
 *   (the old version treated every failure as false, so a transient IDB fault
 *   could trap a legitimate user in the 15-minute brute-force lockout)
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

// LockScreen only uses CountdownTimer from the common barrel, but the barrel
// also pulls in QRCodeDisplay→bc-ur→cborg (incompatible exports map) — stub only what's needed
vi.mock('@/ui/components/common', () => ({
  CountdownTimer: () => null,
}))

import { LockScreen } from '@/ui/screens/Lock/LockScreen'

async function typePin(digits: string) {
  for (const d of digits) {
    // NumericKeypad takes input via onPointerDown
    fireEvent.pointerDown(screen.getByRole('button', { name: d }))
  }
}

describe('LockScreen lockout counting contract', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('wrong PIN (resolve false) → counts: shows wrongPin + remaining attempts', async () => {
    const onUnlock = vi.fn().mockResolvedValue(false)
    render(<LockScreen onUnlock={onUnlock} maxAttempts={5} />)

    await typePin('111111')
    await waitFor(() => expect(onUnlock).toHaveBeenCalledWith('111111'))

    // wrongPin interpolated with remaining = 5-1 = 4
    await screen.findByText('lock.wrongPin')
    expect(localStorage.getItem('lockout')).toBeNull() // still below threshold — no record
  })

  it('infra failure (reject) → shows errorOccurred, no counting or lockout record', async () => {
    const onUnlock = vi.fn().mockRejectedValue(new Error('storage down'))
    render(<LockScreen onUnlock={onUnlock} maxAttempts={2} lockoutDurationMinutes={15} />)

    // maxAttempts=2, but 3 infra failures must not lock
    for (let i = 0; i < 3; i += 1) {
      await typePin('222222')
      await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(i + 1))
      await screen.findByText('lock.errorOccurred')
    }

    expect(localStorage.getItem('lockout')).toBeNull()
    expect(screen.queryByText(/lock.lockedOut/)).toBeNull()
  })

  it('records lockout when wrong PIN reaches the threshold (brute-force defense intact)', async () => {
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

  // ─── grace invalidation on lockout (LockScreen rendered ⇒ grace must be absent) ───

  it('reaching the lockout threshold fires onLockout (invalidates grace)', async () => {
    const onUnlock = vi.fn().mockResolvedValue(false)
    const onLockout = vi.fn()
    render(<LockScreen onUnlock={onUnlock} maxAttempts={2} onLockout={onLockout} />)

    await typePin('333333')
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1))
    expect(onLockout).not.toHaveBeenCalled() // below threshold — no invalidation yet

    await typePin('444444')
    await waitFor(() => expect(onLockout).toHaveBeenCalled())
  })

  it('mounting while already locked out fires onLockout (relaunch can not bypass)', async () => {
    localStorage.setItem(
      'lockout',
      JSON.stringify({ until: Date.now() + 15 * 60 * 1000, attempts: 5 }),
    )
    const onLockout = vi.fn()
    render(<LockScreen onUnlock={vi.fn().mockResolvedValue(false)} onLockout={onLockout} />)

    await waitFor(() => expect(onLockout).toHaveBeenCalled())
  })

  it('does not fire onLockout on a wrong PIN below the threshold', async () => {
    const onUnlock = vi.fn().mockResolvedValue(false)
    const onLockout = vi.fn()
    render(<LockScreen onUnlock={onUnlock} maxAttempts={5} onLockout={onLockout} />)

    await typePin('111111')
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1))
    await screen.findByText('lock.wrongPin')
    expect(onLockout).not.toHaveBeenCalled()
  })
})
