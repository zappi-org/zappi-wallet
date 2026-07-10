import { useState, useCallback } from 'react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/shallow'
import { satsToFiat, fiatToSats, FIAT_CURRENCY_MAP, isZeroDecimalCurrency } from '@/utils/format'

interface UseFiatToggleOptions {
  initialFiatMode?: boolean
  initialFiatAmount?: string
}

interface UseFiatToggleReturn {
  isFiatMode: boolean
  fiatInput: string
  fiatCurrency: string
  currencySymbol: string
  showFiat: boolean
  exchangeRate: number | null
  handleToggleFiat: () => void
  handleFiatChange: (rawValue: string) => void
  /** Derive the fiat field from a sat amount using the currency's canonical format. */
  syncFiatFromSats: (sats: number) => void
}

/** Canonical sats→fiat field text: zero-decimal currencies round; others trim trailing zeros. */
function formatFiatFieldFromSats(sats: number, rate: number, zeroDecimal: boolean): string {
  if (sats <= 0) return ''
  const fiat = satsToFiat(sats, rate)
  return zeroDecimal
    ? Math.round(fiat).toString()
    : fiat
        .toFixed(2)
        .replace(/\.00$/, '')
        .replace(/(\.\d)0$/, '$1')
}

export function useFiatToggle(
  amount: string,
  setAmount: (v: string) => void,
  options: UseFiatToggleOptions = {},
): UseFiatToggleReturn {
  const { fiatCurrency, showFiat, exchangeRate } = useAppStore(
    useShallow((s) => ({
      fiatCurrency: s.settings.fiatCurrency ?? 'USD',
      showFiat: s.settings.showFiatConversion ?? true,
      exchangeRate: s.allRates?.[s.settings.fiatCurrency ?? 'USD'] ?? null,
    })),
  )
  const currencySymbol = FIAT_CURRENCY_MAP.get(fiatCurrency)?.symbol ?? fiatCurrency
  const zeroDecimal = isZeroDecimalCurrency(fiatCurrency)

  const [isFiatMode, setIsFiatMode] = useState(options.initialFiatMode ?? false)
  const [fiatInput, setFiatInput] = useState(options.initialFiatAmount ?? '')

  const syncFiatFromSats = useCallback(
    (sats: number) => {
      if (!exchangeRate) return
      setFiatInput(formatFiatFieldFromSats(sats, exchangeRate, zeroDecimal))
    },
    [exchangeRate, zeroDecimal],
  )

  const handleToggleFiat = useCallback(() => {
    if (!exchangeRate) return
    if (!isFiatMode && amount) {
      setFiatInput(formatFiatFieldFromSats(Number(amount), exchangeRate, zeroDecimal))
    }
    setIsFiatMode(!isFiatMode)
  }, [isFiatMode, amount, exchangeRate, zeroDecimal])

  const handleFiatChange = useCallback((rawValue: string) => {
    const v = rawValue.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
    setFiatInput(v)
    const num = parseFloat(v)
    if (!isNaN(num) && num > 0 && exchangeRate) {
      setAmount(String(fiatToSats(num, exchangeRate)))
    } else {
      setAmount('')
    }
  }, [exchangeRate, setAmount])

  return {
    isFiatMode,
    fiatInput,
    fiatCurrency,
    currencySymbol,
    showFiat,
    exchangeRate,
    handleToggleFiat,
    handleFiatChange,
    syncFiatFromSats,
  }
}
