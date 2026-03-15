/**
 * Supported fiat currencies for exchange rate display
 */
export type FiatCurrency =
  | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'KRW'
  | 'CNY' | 'TWD' | 'HKD' | 'SGD' | 'AUD'
  | 'CAD' | 'CHF' | 'MXN' | 'BRL' | 'IDR'
  | 'THB' | 'PHP' | 'MYR' | 'INR' | 'TRY'
  | 'SEK' | 'NOK' | 'DKK' | 'NZD' | 'ZAR'
  | 'COP' | 'ARS' | 'CLP' | 'PEN' | 'VND'
  | 'CZK' | 'HUF' | 'ILS' | 'PLN' | 'RUB'
  | 'SAR' | 'AED' | 'PKR' | 'EGP' | 'NGN'
  | 'BDT' | 'UAH' | 'RON' | 'KWD' | 'ISK'
  | 'MAD' | 'LKR' | 'MMK'

/**
 * Fiat currency metadata for picker UI
 */
export interface FiatCurrencyInfo {
  code: FiatCurrency
  symbol: string
  name: string
  flag: string
}

/**
 * Exchange rate cache record (stored in IndexedDB)
 */
export interface ExchangeRateCache {
  id: string // 'current'
  rates: Record<string, number> // { USD: 95000, EUR: 87000, KRW: 130000000, ... }
  fetchedAt: number
}

// Re-export from canonical location for backward compatibility
export { FIAT_CURRENCIES } from '@/core/constants/fiat'
