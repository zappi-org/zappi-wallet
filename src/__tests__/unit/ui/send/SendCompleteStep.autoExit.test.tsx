import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'

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
  useTranslation: () => ({
    t: stableT,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/utils/format', async () => {
  const actual = await vi.importActual<typeof import('@/utils/format')>('@/utils/format')
  return {
    ...actual,
    useFormatSats: () => (v: number) => `${v} sats`,
    useFormatFiat: () => () => null,
  }
})

vi.mock('@/store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ settings: { fiatCurrency: 'USD' } }),
}))

vi.mock('@/ui/hooks/use-mint-metadata', () => ({
  useMintMetadata: () => ({
    getDisplayName: (url: string) => url,
    getIconUrl: () => undefined,
    getMetadata: () => undefined,
  }),
}))

import { SendCompleteStep } from '@/ui/screens/Send/steps/SendCompleteStep'
import type { SendableValidatedData } from '@/ui/screens/Send/SendFlow'

const validatedData = {
  type: 'lightning-address',
  value: 'user@zappi.cash',
} as unknown as SendableValidatedData

const baseProps = {
  validatedData,
  amount: 1000,
  displayName: 'user@zappi.cash',
}

beforeEach(() => {
  cleanup()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SendCompleteStep auto-exit', () => {
  it('exits on its own after 8s when the user never touches the screen', () => {
    const onComplete = vi.fn()
    render(<SendCompleteStep {...baseProps} onComplete={onComplete} />)

    vi.advanceTimersByTime(8000)

    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it('cancels the auto-exit on a pointerdown — a touch means the user is still reading', () => {
    const onComplete = vi.fn()
    render(<SendCompleteStep {...baseProps} onComplete={onComplete} />)

    fireEvent.pointerDown(window)
    vi.advanceTimersByTime(8000)

    expect(onComplete).not.toHaveBeenCalled()
  })

  it('cancels the auto-exit on a keydown', () => {
    const onComplete = vi.fn()
    render(<SendCompleteStep {...baseProps} onComplete={onComplete} />)

    fireEvent.keyDown(window)
    vi.advanceTimersByTime(8000)

    expect(onComplete).not.toHaveBeenCalled()
  })
})
