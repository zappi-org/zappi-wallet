/**
 * ExchangeRateAdapter — ExchangeRateProvider port 구현
 *
 * Coinbase + Upbit에서 BTC 환율 fetch.
 * 외부 라이브러리 불필요 — fetch API만 사용.
 * 쓰로틀링 + in-flight 중복 제거 내장.
 */

import type { ExchangeRateProvider, ExchangeRates } from '@/core/ports/driven/exchange-rate.port'
import type { FiatCurrency } from '@/core/types/fiat'
import { FIAT_CURRENCIES } from '@/core/constants/fiat'
import { EXCHANGE_RATE } from '@/core/constants'

interface CoinbaseResponse {
  data: {
    currency: string
    rates: Record<string, string>
  }
}

interface UpbitTickerResponse {
  market: string
  trade_price: number
}

const SUPPORTED_CODES: Set<string> = new Set(FIAT_CURRENCIES.map(c => c.code))

export class ExchangeRateAdapter implements ExchangeRateProvider {
  private cachedRates: ExchangeRates | null = null
  private inFlightRequest: Promise<ExchangeRates | null> | null = null
  private lastFetchAt = 0

  async fetchRates(): Promise<ExchangeRates | null> {
    if (this.shouldThrottle() && this.cachedRates) {
      return this.cachedRates
    }

    if (this.inFlightRequest) return this.inFlightRequest

    this.inFlightRequest = this.doFetch()
    try {
      return await this.inFlightRequest
    } finally {
      this.inFlightRequest = null
    }
  }

  async getRate(currency: FiatCurrency): Promise<number | null> {
    const rates = this.cachedRates ?? await this.fetchRates()
    if (!rates) return null
    const rate = rates.rates[currency]
    return rate != null ? rate : null
  }

  private shouldThrottle(): boolean {
    return Date.now() - this.lastFetchAt < EXCHANGE_RATE.THROTTLE_MS
  }

  private async doFetch(): Promise<ExchangeRates | null> {
    try {
      const [coinbaseRates, upbitKrw] = await Promise.all([
        this.fetchFromCoinbase(),
        this.fetchFromUpbit(),
      ])

      if (!coinbaseRates) return null

      const rates = { ...coinbaseRates }
      if (upbitKrw != null) {
        rates['KRW'] = upbitKrw
      }

      const now = Date.now()
      this.lastFetchAt = now
      this.cachedRates = { rates, fetchedAt: now }

      return this.cachedRates
    } catch {
      return null
    }
  }

  private async fetchFromCoinbase(): Promise<Record<string, number> | null> {
    try {
      const response = await fetch(
        'https://api.coinbase.com/v2/exchange-rates?currency=BTC',
        { signal: AbortSignal.timeout(EXCHANGE_RATE.FETCH_TIMEOUT) },
      )

      if (!response.ok) return null

      const data: CoinbaseResponse = await response.json()
      const rates: Record<string, number> = {}

      for (const [currency, rate] of Object.entries(data.data.rates)) {
        if (!SUPPORTED_CODES.has(currency)) continue
        const parsed = parseFloat(rate)
        if (!isNaN(parsed) && parsed > 0) {
          rates[currency] = parsed
        }
      }

      return rates
    } catch {
      return null
    }
  }

  private async fetchFromUpbit(): Promise<number | null> {
    try {
      const response = await fetch(
        'https://api.upbit.com/v1/ticker?markets=KRW-BTC',
        { signal: AbortSignal.timeout(EXCHANGE_RATE.FETCH_TIMEOUT) },
      )

      if (!response.ok) return null

      const data: UpbitTickerResponse[] = await response.json()
      if (data.length > 0 && data[0].trade_price > 0) {
        return data[0].trade_price
      }

      return null
    } catch {
      return null
    }
  }
}
