import { useState, useCallback } from 'react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/shallow'
import { satsToFiat, fiatToSats, FIAT_CURRENCY_MAP } from '@/utils/format'

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
  setFiatInput: (value: string) => void
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

  const [isFiatMode, setIsFiatMode] = useState(options.initialFiatMode ?? false)
  const [fiatInput, setFiatInput] = useState(options.initialFiatAmount ?? '')

  const handleToggleFiat = useCallback(() => {
    if (!exchangeRate) return
    if (!isFiatMode && amount) {
      const fiat = satsToFiat(Number(amount), exchangeRate)
      setFiatInput(fiat >= 1 ? Math.round(fiat).toString() : fiat.toFixed(2))
    }
    setIsFiatMode(!isFiatMode)
  }, [isFiatMode, amount, exchangeRate])

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
    setFiatInput,
  }
}
