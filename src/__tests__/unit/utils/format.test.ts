import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { formatFiatAmount, formatTransactionFiat } from '@/utils/format'

describe('formatTransactionFiat', () => {
  beforeEach(() => {
    const state = useAppStore.getState()
    useAppStore.setState({
      settings: {
        ...state.settings,
        fiatCurrency: 'USD',
        showFiatConversion: true,
      },
      allRates: { USD: 100_000 },
    })
  })

  it('shows a stored snapshot when fiat display is enabled', () => {
    expect(
      formatTransactionFiat(
        { amount: 1.23, currency: 'USD' },
        1_000,
        () => null,
      ),
    ).toBe(formatFiatAmount(1.23, 'USD'))
  })

  it('hides a stored snapshot when fiat display is disabled', () => {
    const state = useAppStore.getState()
    useAppStore.setState({
      settings: {
        ...state.settings,
        showFiatConversion: false,
      },
    })

    expect(
      formatTransactionFiat(
        { amount: 1.23, currency: 'USD' },
        1_000,
        () => '$live',
      ),
    ).toBeNull()
  })

  it('hides live fiat fallback when fiat display is disabled', () => {
    const state = useAppStore.getState()
    useAppStore.setState({
      settings: {
        ...state.settings,
        showFiatConversion: false,
      },
    })

    expect(formatTransactionFiat(null, 1_000, () => '$live')).toBeNull()
  })
})
