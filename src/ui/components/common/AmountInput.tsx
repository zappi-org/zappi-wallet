/**
 * AmountInput — Shared sats/fiat dual-mode amount input
 * Used in SendInputStep and ReceiveInputStep
 */

import { useState, useCallback, type RefObject } from 'react'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/shallow'
import { useSatUnit, satsToFiat, fiatToSats, formatFiatAmount, FIAT_CURRENCY_MAP } from '@/utils/format'

interface AmountInputProps {
  /** Current sats amount as string (controlled) */
  amount: string
  /** Called when sats amount changes */
  onAmountChange: (sats: string) => void
  /** Label shown above the input */
  label: string
  /** Ref forwarded to the underlying input */
  inputRef?: RefObject<HTMLInputElement | null>
  /** Whether amount editing is disabled (e.g. bolt11 with fixed amount) */
  disabled?: boolean
  /** Error message shown below the input */
  error?: string | null
}

export function AmountInput({
  amount,
  onAmountChange,
  label,
  inputRef,
  disabled = false,
  error,
}: AmountInputProps) {
  const unit = useSatUnit()
  const { fiatCurrency, showFiat, exchangeRate } = useAppStore(
    useShallow((s) => {
      const cur = s.settings.fiatCurrency ?? 'USD'
      return {
        fiatCurrency: cur,
        showFiat: s.settings.showFiatConversion ?? true,
        exchangeRate: s.allRates?.[cur] ?? null,
      }
    }),
  )

  const [isFiatMode, setIsFiatMode] = useState(false)
  const [fiatInput, setFiatInput] = useState('')

  const currencySymbol = FIAT_CURRENCY_MAP.get(fiatCurrency)?.symbol ?? fiatCurrency

  const handleToggleMode = useCallback(() => {
    if (!isFiatMode && amount && exchangeRate) {
      const fiat = satsToFiat(Number(amount), exchangeRate)
      setFiatInput(fiat >= 1 ? Math.round(fiat).toString() : fiat.toFixed(2))
    }
    setIsFiatMode(!isFiatMode)
  }, [isFiatMode, amount, exchangeRate])

  const formatFiatInput = (raw: string) => {
    const [int, dec] = raw.split('.')
    const formatted = int ? Number(int).toLocaleString() : ''
    return dec !== undefined ? `${formatted}.${dec}` : formatted
  }

  const handleFiatChange = useCallback((rawValue: string) => {
    const v = rawValue.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
    setFiatInput(v)
    const num = parseFloat(v)
    if (!isNaN(num) && num > 0 && exchangeRate) {
      onAmountChange(String(fiatToSats(num, exchangeRate)))
    } else {
      onAmountChange('')
    }
  }, [exchangeRate, onAmountChange])

  const handleSatsChange = useCallback((rawValue: string) => {
    const v = rawValue.replace(/[^0-9]/g, '')
    if (Number(v) > 2_100_000_000_000_000) return
    onAmountChange(v)
  }, [onAmountChange])

  const fiatHint = amount && showFiat && exchangeRate
    ? formatFiatAmount(satsToFiat(Number(amount), exchangeRate), fiatCurrency)
    : null

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-label text-foreground-muted leading-snug">{label}</p>
        {exchangeRate && showFiat && !disabled && (
          <button
            onClick={handleToggleMode}
            className="text-label font-bold text-accent-primary px-3 py-1 rounded-full bg-accent-primary/10 hover:bg-accent-primary/15 transition-colors"
          >
            {isFiatMode ? `→ ${unit}` : `→ ${fiatCurrency}`}
          </button>
        )}
      </div>
      {isFiatMode && exchangeRate ? (
        <>
          <div className="relative">
            <span className="absolute left-0 top-1/2 -translate-y-1/2 text-foreground-muted font-medium text-title">
              {currencySymbol}
            </span>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={fiatInput ? formatFiatInput(fiatInput) : ''}
              placeholder="0"
              onChange={(e) => handleFiatChange(e.target.value)}
              onFocus={(e) => { if (!fiatInput) e.target.select() }}
              className={`w-full bg-transparent border-0 border-b border-b-border rounded-none pl-8 py-2 text-title font-bold focus:outline-none focus:border-b-foreground transition-colors ${fiatInput ? 'text-foreground' : 'text-foreground-muted/40'}`}
            />
          </div>
          {amount && (
            <p className="text-foreground-muted text-caption mt-1">
              ≈ {Number(amount).toLocaleString()} sats
            </p>
          )}
        </>
      ) : (
        <>
          <div className="relative">
            {unit === '₿' ? (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 text-foreground-muted font-medium text-title">{unit}</span>
            ) : (
              <span className="absolute right-0 top-1/2 -translate-y-1/2 text-foreground-muted font-medium text-subtitle">{unit}</span>
            )}
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              value={amount ? Number(amount).toLocaleString() : ''}
              placeholder="0"
              onChange={(e) => handleSatsChange(e.target.value)}
              onFocus={(e) => { if (!amount) e.target.select() }}
              disabled={disabled}
              className={`w-full bg-transparent border-0 border-b border-b-border rounded-none ${unit === '₿' ? 'pl-8' : 'pr-12'} py-2 text-title font-bold focus:outline-none focus:border-b-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${amount ? 'text-foreground' : 'text-foreground-muted/40'}`}
            />
          </div>
          {fiatHint && (
            <p className="text-foreground-muted text-caption mt-1">≈ {fiatHint}</p>
          )}
        </>
      )}
      {error && (
        <p className="text-accent-danger text-caption mt-1 font-bold">{error}</p>
      )}
    </div>
  )
}
