import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'

const stableT = (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: stableT,
    i18n: { language: 'en' },
  }),
}))

vi.mock('@/hooks', () => ({
  useMintMetadata: () => ({
    getDisplayName: (url: string) => url,
  }),
  useWallet: () => ({ balance: 0 }),
}))

vi.mock('@/utils/format', () => ({
  useFormatSats: () => (v: number) => `${v} sats`,
  useFormatFiat: () => () => '',
  formatTransactionFiat: () => '',
}))

vi.mock('@/store', () => ({
  useAppStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ settings: { mints: [], showFiatConversion: false, fiatCurrency: 'USD' } }),
}))

import { HistoryScreen } from '@/ui/screens/History/HistoryScreen'

describe('HistoryScreen', () => {
  beforeEach(() => {
    cleanup()
  })

  it('should not auto-focus any element on mount', () => {
    const { container } = render(
      <HistoryScreen
        onBack={vi.fn()}
        transactions={[]}
      />
    )

    const searchInput = container.querySelector('input[type="text"]')
    expect(document.activeElement).not.toBe(searchInput)
    expect(document.activeElement).toBe(document.body)
  })
})
