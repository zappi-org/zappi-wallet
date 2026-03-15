import { getDatabase } from '@/data/database'
import type { ExchangeRateCache } from '@/core/types'

const CURRENT_ID = 'current'

/**
 * Repository for caching exchange rates in IndexedDB (offline support)
 */
export class ExchangeRateRepository {
  private get db() {
    return getDatabase()
  }

  /**
   * Get cached exchange rates
   */
  async get(): Promise<ExchangeRateCache | null> {
    const record = await this.db.exchangeRates.get(CURRENT_ID)
    if (!record) return null
    return record
  }

  /**
   * Save exchange rates to cache
   */
  async save(rates: Record<string, number>, fetchedAt: number): Promise<void> {
    await this.db.exchangeRates.put({ id: CURRENT_ID, rates, fetchedAt })
  }

  /**
   * Clear cached exchange rates
   */
  async clear(): Promise<void> {
    await this.db.exchangeRates.clear()
  }
}
