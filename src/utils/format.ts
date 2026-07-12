import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { FIAT_CURRENCIES } from '@/core/types/fiat'
import { useShallow } from 'zustand/shallow'

type UnitDisplay = 'bip177' | 'sats'

function getUnitDisplay(): UnitDisplay {
  return useAppStore.getState().settings.unitDisplay ?? 'bip177'
}

function unitLabel(unit: UnitDisplay): string {
  return unit === 'sats' ? 'sats' : '₿'
}

function formatAmount(amount: number, unit: UnitDisplay): string {
  const formatted = amount.toLocaleString()
  if (unit === 'sats') {
    return `${formatted} ${amount === 1 ? 'sat' : 'sats'}`
  }
  return `₿${formatted}`
}

// ── Non-reactive (callbacks, services, error messages) ──

export function satUnit(): string {
  return unitLabel(getUnitDisplay())
}

export function formatSats(amount: number): string {
  return formatAmount(amount, getUnitDisplay())
}

// ── Reactive hooks (React component JSX) ──

export function useSatUnit(): string {
  const unit = useAppStore((s) => s.settings.unitDisplay ?? 'bip177')
  return unitLabel(unit)
}

export function useFormatSats(): (amount: number) => string {
  const unit = useAppStore((s) => s.settings.unitDisplay ?? 'bip177')
  return useCallback((amount: number) => formatAmount(amount, unit), [unit])
}

// ── Fiat conversion (pure functions) ──

export function satsToFiat(sats: number, btcRate: number): number {
  return (sats / 100_000_000) * btcRate
}

export function fiatToSats(fiat: number, btcRate: number): number {
  return Math.round((fiat / btcRate) * 100_000_000)
}

// ── Fiat formatting ──

/** O(1) lookup map for currency info */
const FIAT_CURRENCY_MAP = new Map(FIAT_CURRENCIES.map(c => [c.code, c]))

export { FIAT_CURRENCY_MAP }

/** Cache Intl.NumberFormat instances by key to avoid re-creation */
const formatterCache = new Map<string, Intl.NumberFormat>()

const currencyFractionDigitsCache = new Map<string, number>()

/** ISO 4217 minor-unit precision supplied by the runtime's currency formatter. */
export function getFiatFractionDigits(code: string): number {
  const cached = currencyFractionDigitsCache.get(code)
  if (cached !== undefined) return cached

  let digits = 2
  try {
    digits = new Intl.NumberFormat(undefined, { style: 'currency', currency: code })
      .resolvedOptions().maximumFractionDigits ?? 2
  } catch {
    // Unknown/custom codes keep the conventional two-decimal fallback.
  }
  currencyFractionDigitsCache.set(code, digits)
  return digits
}

export function isZeroDecimalCurrency(code: string): boolean {
  return getFiatFractionDigits(code) === 0
}

/**
 * Format a fiat amount with currency symbol using Intl.NumberFormat.
 * JPY/KRW: no decimals. Others: up to 2 decimals.
 * Caches formatter instances for performance.
 */
export function formatFiatAmount(amount: number, currency: string): string {
  const fractionDigits = getFiatFractionDigits(currency)
  const key = `${currency}:${fractionDigits}`

  try {
    let fmt = formatterCache.get(key)
    if (!fmt) {
      fmt = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: fractionDigits,
      })
      formatterCache.set(key, fmt)
    }
    return fmt.format(amount)
  } catch {
    // Fallback for unknown currency codes
    return `${currency} ${amount.toFixed(fractionDigits)}`
  }
}

/** Formats grouping separators for keypad/input fiat entry without destroying an
 *  in-progress decimal (`'1234.'` stays `'1,234.'`, `'1234.50'` keeps the trailing zero). */
export function formatFiatInputForDisplay(value: string): string {
  if (!value) return '0'
  const [integer = '0', fraction] = value.split('.')
  const groupedInteger = Number(integer || '0').toLocaleString()
  return value.includes('.') ? `${groupedInteger}${getFiatDecimalSeparator()}${fraction ?? ''}` : groupedInteger
}

/** Localizes only the separator for a live text field; grouping would move the caret. */
export function formatFiatInputForEditing(value: string): string {
  return value.replace('.', getFiatDecimalSeparator())
}

/** Locale-visible separator; fiat input remains canonicalized to `.` internally. */
export function getFiatDecimalSeparator(): string {
  return new Intl.NumberFormat().formatToParts(1.1).find((part) => part.type === 'decimal')?.value ?? '.'
}

function getFiatGroupSeparator(): string {
  return new Intl.NumberFormat().formatToParts(1000).find((part) => part.type === 'group')?.value ?? ','
}

/**
 * Preserve editable money states (`0`, `0.`, `0.05`) while removing grouping,
 * duplicate separators, excess precision, and redundant leading zeros.
 */
export function normalizeFiatInput(rawValue: string, fractionDigits: number): string {
  if (!rawValue) return ''

  const decimalSeparator = getFiatDecimalSeparator()
  const groupSeparator = getFiatGroupSeparator()
  let value = rawValue.trim()

  const hasLocalizedDecimal = decimalSeparator !== '.' && value.includes(decimalSeparator)
  if (groupSeparator && groupSeparator !== decimalSeparator && (decimalSeparator === '.' || hasLocalizedDecimal)) {
    value = value.split(groupSeparator).join('')
  }
  if (decimalSeparator !== '.') {
    value = value.split(decimalSeparator).join('.')
  }
  value = value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
  if (!value) return ''

  const hasDecimal = value.includes('.')
  const [rawInteger = '', rawFraction = ''] = value.split('.')
  const integer = (rawInteger || '0').replace(/^0+(?=\d)/, '')
  if (!hasDecimal || fractionDigits === 0) return integer
  return `${integer}.${rawFraction.slice(0, fractionDigits)}`
}

/** Applies one custom-keypad key without collapsing in-progress decimal text. */
export function appendFiatInput(
  current: string,
  key: string,
  fractionDigits: number,
  maxLength = 12,
): string {
  if (key === 'decimal') {
    if (fractionDigits === 0 || current.includes('.')) return current
    return current ? `${current}.` : '0.'
  }
  if (!/^\d+$/.test(key)) return current

  const decimalIndex = current.indexOf('.')
  if (decimalIndex !== -1 && current.length - decimalIndex - 1 + key.length > fractionDigits) return current

  const next = current === '0' && !current.includes('.')
    ? (/^0+$/.test(key) ? '0' : key.replace(/^0+/, ''))
    : `${current}${key}`
  return next.length <= maxLength ? next : current
}

// ── Derive exchange rate from store (internal helper) ──

function getExchangeRateFromStore(): { rate: number | null; currency: string; show: boolean } {
  const state = useAppStore.getState()
  const currency = state.settings.fiatCurrency ?? 'USD'
  const show = state.settings.showFiatConversion ?? true
  const rate = state.allRates?.[currency] ?? null
  return { rate, currency, show }
}

// ── Reactive hooks for fiat (React component JSX) ──

/**
 * Returns a formatter that converts sats to a fiat string.
 * Returns null if exchange rate is unavailable or fiat display is off.
 *
 * Uses a single shallow selector to minimize Zustand subscriptions.
 */
export function useFormatFiat(): (sats: number) => string | null {
  const { rate, currency, show } = useAppStore(
    useShallow((s) => {
      const cur = s.settings.fiatCurrency ?? 'USD'
      return {
        rate: s.allRates?.[cur] ?? null,
        currency: cur,
        show: s.settings.showFiatConversion ?? true,
      }
    }),
  )

  return useCallback(
    (sats: number) => {
      if (!show || !rate) return null
      const fiat = satsToFiat(sats, rate)
      return formatFiatAmount(fiat, currency)
    },
    [rate, currency, show],
  )
}

// ── Transaction fiat helper (prefer stored snapshot, fallback to live) ──

/**
 * Returns fiat string for a transaction, preferring the stored snapshot
 * (historical accuracy) over the live exchange rate.
 */
export function formatTransactionFiat(
  snapshot: { amount: number; currency: string } | undefined | null,
  amountSats: number,
  liveFiatFormatter: (sats: number) => string | null,
): string | null {
  const { show } = getExchangeRateFromStore()
  if (!show) return null
  if (snapshot) {
    return formatFiatAmount(snapshot.amount, snapshot.currency)
  }
  return liveFiatFormatter(amountSats)
}

/** Middle-ellipsis truncation for long strings where head and tail matter (hashes, tokens, URLs). */
export function truncateStr(s: string, max = 36): string {
  return s.length > max ? `${s.slice(0, 16)}...${s.slice(-16)}` : s
}

// ── Locale + date helpers ──

const LOCALE_MAP: Record<string, string> = {
  ko: 'ko-KR',
  ja: 'ja-JP',
  es: 'es-ES',
  id: 'id-ID',
  en: 'en-US',
}

export function getLocaleCode(language: string): string {
  return LOCALE_MAP[language] || 'en-US'
}

export function formatDateLocalized(
  timestamp: number,
  language: string,
  todayLabel: string,
  yesterdayLabel: string,
): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  )
  const locale = getLocaleCode(language)

  if (diffDays === 0) {
    return `${todayLabel}, ${date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    })}`
  }
  if (diffDays === 1) {
    return `${yesterdayLabel}, ${date.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    })}`
  }
  return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
}

// ── Non-reactive fiat (services, callbacks) ──

/**
 * Format sats as fiat string using current store state.
 * Returns null if rate unavailable or display disabled.
 */
export function formatFiat(sats: number): string | null {
  const { rate, currency, show } = getExchangeRateFromStore()
  if (!show || !rate) return null
  return formatFiatAmount(satsToFiat(sats, rate), currency)
}
