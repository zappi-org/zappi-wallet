import { getDatabase } from '@/adapters/storage/dexie/schema'
import { EXCHANGE_RATE } from '@/core/constants'
import { FIAT_CURRENCIES } from '@/core/types/fiat'

/** Port: store access for exchange rate data */
export interface ExchangeRateStore {
  getAllRates(): Record<string, number> | null
  getFetchedAt(): number | null
  setRates(rates: Record<string, number>, fetchedAt: number): void
}

/** Set of supported currency codes for fast filtering */
const SUPPORTED_CODES: Set<string> = new Set(FIAT_CURRENCIES.map(c => c.code))

/**
 * Coinbase exchange rate API response
 */
interface CoinbaseResponse {
  data: {
    currency: string
    rates: Record<string, string>
  }
}

/**
 * Upbit ticker API response
 */
interface UpbitTickerResponse {
  market: string
  trade_price: number
}

/**
 * Service for fetching and caching BTC exchange rates.
 * Uses Coinbase for all currencies, Upbit for KRW override.
 * Follows MintMetadataService pattern: cache-first, throttle, in-flight dedup.
 */
const EXCHANGE_RATE_ID = 'current'

class ExchangeRateService {
  private store: ExchangeRateStore
  private inFlightRequest: Promise<Record<string, number> | null> | null = null
  private lastFetchAt = 0

  constructor(store: ExchangeRateStore) {
    this.store = store
  }

  /**
   * Fetch all exchange rates (throttled, deduplicated)
   * Updates store and IndexedDB cache on success.
   * Returns cached rates if within throttle window.
   */
  async fetchRates(): Promise<Record<string, number> | null> {
    // Throttle: return cached if recently fetched
    if (this.shouldThrottle()) {
      const cached = this.store.getAllRates()
      if (cached) return cached
    }

    // Deduplicate in-flight requests
    if (this.inFlightRequest) return this.inFlightRequest

    this.inFlightRequest = this.doFetch()

    try {
      return await this.inFlightRequest
    } finally {
      this.inFlightRequest = null
    }
  }

  /**
   * Load cached rates from IndexedDB into store (called on app init)
   */
  async loadCachedRates(): Promise<void> {
    const cached = await getDatabase().exchangeRates.get(EXCHANGE_RATE_ID)
    if (!cached) return

    this.store.setRates(cached.rates, cached.fetchedAt)
    this.lastFetchAt = cached.fetchedAt
  }

  /**
   * Get rate for a specific currency from store (synchronous)
   */
  getRate(currency: string): number | null {
    const allRates = this.store.getAllRates()
    if (!allRates) return null
    const rate = allRates[currency]
    return rate != null ? Number(rate) : null
  }

  /**
   * Check if cached rates are stale (older than STALE_MS)
   */
  isStale(): boolean {
    const fetchedAt = this.store.getFetchedAt()
    if (!fetchedAt) return true
    return Date.now() - fetchedAt > EXCHANGE_RATE.STALE_MS
  }

  /**
   * Fetch rates if stale, otherwise return cached (for UI mount triggers)
   */
  async refreshIfStale(): Promise<void> {
    if (this.isStale()) {
      await this.fetchRates()
    }
  }

  // ── Private ──

  private shouldThrottle(): boolean {
    return Date.now() - this.lastFetchAt < EXCHANGE_RATE.THROTTLE_MS
  }

  private async doFetch(): Promise<Record<string, number> | null> {
    try {
      // Fetch Coinbase + Upbit in parallel
      const [coinbaseRates, upbitKrw] = await Promise.all([
        this.fetchFromCoinbase(),
        this.fetchFromUpbit(),
      ])

      if (!coinbaseRates) return null

      // Override KRW with Upbit price (more accurate for Korean market)
      const rates: Record<string, number> = { ...coinbaseRates }
      if (upbitKrw != null) {
        rates['KRW'] = upbitKrw
      }

      // Persist to IndexedDB
      const now = Date.now()
      await getDatabase().exchangeRates.put({ id: EXCHANGE_RATE_ID, rates, fetchedAt: now })
      this.lastFetchAt = now

      // Update store
      this.store.setRates(rates, now)

      return rates
    } catch (error) {
      console.warn('[ExchangeRate] Failed to fetch rates:', error)
      return null
    }
  }

  private async fetchFromCoinbase(): Promise<Record<string, number> | null> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), EXCHANGE_RATE.FETCH_TIMEOUT)

      const response = await fetch(
        'https://api.coinbase.com/v2/exchange-rates?currency=BTC',
        { signal: controller.signal },
      )
      clearTimeout(timeoutId)

      if (!response.ok) {
        console.warn(`[ExchangeRate] Coinbase API error: ${response.status}`)
        return null
      }

      const data: CoinbaseResponse = await response.json()
      const rates: Record<string, number> = {}

      // Only keep rates for supported currencies (30 vs ~160)
      for (const [currency, rate] of Object.entries(data.data.rates)) {
        if (!SUPPORTED_CODES.has(currency)) continue
        const parsed = parseFloat(rate)
        if (!isNaN(parsed) && parsed > 0) {
          rates[currency] = parsed
        }
      }

      return rates
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[ExchangeRate] Coinbase request timed out')
      } else {
        console.warn('[ExchangeRate] Coinbase fetch error:', error)
      }
      return null
    }
  }

  private async fetchFromUpbit(): Promise<number | null> {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), EXCHANGE_RATE.FETCH_TIMEOUT)

      const response = await fetch(
        'https://api.upbit.com/v1/ticker?markets=KRW-BTC',
        { signal: controller.signal },
      )
      clearTimeout(timeoutId)

      if (!response.ok) {
        console.warn(`[ExchangeRate] Upbit API error: ${response.status}`)
        return null
      }

      const data: UpbitTickerResponse[] = await response.json()
      if (data.length > 0 && data[0].trade_price > 0) {
        return data[0].trade_price
      }

      return null
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('[ExchangeRate] Upbit request timed out')
      } else {
        console.warn('[ExchangeRate] Upbit fetch error:', error)
      }
      return null
    }
  }
}

// ── Default adapter: Zustand store ──

import { useAppStore } from '@/store'

function createZustandStoreAdapter(): ExchangeRateStore {
  return {
    getAllRates: () => useAppStore.getState().allRates,
    getFetchedAt: () => useAppStore.getState().exchangeRateFetchedAt,
    setRates: (rates, fetchedAt) => useAppStore.getState().setExchangeRates(rates, fetchedAt),
  }
}

export const exchangeRateService = new ExchangeRateService(createZustandStoreAdapter())
