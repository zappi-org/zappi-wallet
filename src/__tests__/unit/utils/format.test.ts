import { beforeEach, describe, expect, it } from 'vitest'
import { useAppStore } from '@/store'
import { formatFiatAmount, formatTransactionFiat, getLocaleCode } from '@/utils/format'

describe('getLocaleCode', () => {
  it('maps a bare language tag', () => {
    expect(getLocaleCode('ko')).toBe('ko-KR')
  })

  // The browser detector hands i18next 'ko-KR', which used to fall through to
  // en-US and print English dates inside a Korean UI.
  it('maps a region-tagged language by its base', () => {
    expect(getLocaleCode('ko-KR')).toBe('ko-KR')
    expect(getLocaleCode('es-MX')).toBe('es-ES')
  })

  it('falls back to en-US for anything unknown', () => {
    expect(getLocaleCode('zz')).toBe('en-US')
  })
})

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
