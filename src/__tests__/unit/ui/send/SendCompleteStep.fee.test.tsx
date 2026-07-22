import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

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
  onComplete: () => {},
  displayName: 'user@zappi.cash',
}

beforeEach(() => {
  cleanup()
})

describe('SendCompleteStep fee rows', () => {
  it('shows the actual fee (no "estimated") once the payment settled', () => {
    render(<SendCompleteStep {...baseProps} fee={5} actualFee={3} />)

    expect(screen.getByText('send.confirm.fee')).toBeTruthy()
    expect(screen.getByText('3 sats')).toBeTruthy()
    expect(screen.getByText('1003 sats')).toBeTruthy()
    expect(screen.queryByText('send.confirm.estimatedFee')).toBeNull()
  })

  it('falls back to the estimated fee while no actual fee exists (in_transit)', () => {
    render(<SendCompleteStep {...baseProps} fee={5} pending />)

    expect(screen.getByText('send.confirm.estimatedFee')).toBeTruthy()
    expect(screen.getByText('5 sats')).toBeTruthy()
    expect(screen.getByText('1005 sats')).toBeTruthy()
  })
})
