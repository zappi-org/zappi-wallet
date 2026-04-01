import type { FiatCurrency } from '@/core/types/fiat'

export interface ExchangeRates {
  rates: Record<string, number>
  fetchedAt: number
}

export interface ExchangeRateProvider {
  fetchRates(): Promise<ExchangeRates | null>
  getRate(currency: FiatCurrency): Promise<number | null>
}
