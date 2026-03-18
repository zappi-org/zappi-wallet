import { getDatabase } from '@/data/database'
import { satsToFiat } from '@/utils/format'
import type { Transaction, TransactionDirection, TransactionStatus } from '@/core/types'

export interface FindAllOptions {
  limit?: number
  offset?: number
}

export interface FiatSnapshot {
  fiatCurrency: string
  exchangeRate: number
}

/**
 * Repository for managing transaction records
 */
export class TransactionRepository {
  private fiatSnapshotProvider: (() => FiatSnapshot | null) | null = null

  private get table() {
    return getDatabase().transactions
  }

  /**
   * Register a provider that returns current fiat snapshot data.
   * Called once during app initialization to inject the dependency
   * without coupling to any specific state management library.
   */
  setFiatSnapshotProvider(provider: () => FiatSnapshot | null): void {
    this.fiatSnapshotProvider = provider
  }

  /**
   * Save a transaction (insert or update).
   * Auto-fills fiat fields if exchange rate is available and not already set.
   */
  async save(transaction: Transaction): Promise<void> {
    await this.table.put(this.enrichWithFiat(transaction))
  }

  /**
   * Enrich transaction with fiat snapshot if missing and provider available
   */
  private enrichWithFiat(tx: Transaction): Transaction {
    if (tx.fiatAmount != null) return tx // Already has fiat data
    if (!this.fiatSnapshotProvider) return tx
    const snapshot = this.fiatSnapshotProvider()
    if (!snapshot) return tx
    return {
      ...tx,
      fiatAmount: satsToFiat(tx.amount, snapshot.exchangeRate),
      fiatCurrency: snapshot.fiatCurrency,
      exchangeRate: snapshot.exchangeRate,
    }
  }

  /**
   * Create a new transaction (alias for save, returns id)
   */
  async create(transaction: Transaction): Promise<string> {
    await this.save(transaction)
    return transaction.id
  }

  /**
   * Find a transaction by ID
   */
  async findById(id: string): Promise<Transaction | null> {
    const result = await this.table.get(id)
    return result ?? null
  }

  /**
   * Find all transactions, sorted by createdAt desc
   */
  async findAll(options: FindAllOptions = {}): Promise<Transaction[]> {
    const { limit, offset = 0 } = options

    let query = this.table.orderBy('createdAt').reverse()

    if (offset > 0) {
      query = query.offset(offset)
    }

    if (limit !== undefined) {
      query = query.limit(limit)
    }

    return query.toArray()
  }

  /**
   * Update transaction status
   */
  async updateStatus(id: string, status: TransactionStatus): Promise<void> {
    await this.table.update(id, { status })
  }

  /**
   * Update transaction by ID
   */
  async update(id: string, updates: Partial<Omit<Transaction, 'id'>>): Promise<void> {
    await this.table.update(id, updates)
  }

  /**
   * Find transactions by direction
   */
  async findByDirection(direction: TransactionDirection): Promise<Transaction[]> {
    const results = await this.table
      .where('direction')
      .equals(direction)
      .sortBy('createdAt')
    return results.reverse()
  }

  /**
   * Find transactions by status
   */
  async findByStatus(status: TransactionStatus): Promise<Transaction[]> {
    const results = await this.table
      .where('status')
      .equals(status)
      .sortBy('createdAt')
    return results.reverse()
  }

  /**
   * Find transactions by mint URL
   */
  async findByMint(mintUrl: string): Promise<Transaction[]> {
    const results = await this.table
      .where('mintUrl')
      .equals(mintUrl)
      .sortBy('createdAt')
    return results.reverse()
  }

  /**
   * Delete a transaction by ID
   */
  async delete(id: string): Promise<void> {
    await this.table.delete(id)
  }

  /**
   * Delete all transactions
   */
  async deleteAll(): Promise<void> {
    await this.table.clear()
  }

  /**
   * Count all transactions
   */
  async count(): Promise<number> {
    return this.table.count()
  }

  /**
   * Delete transactions older than specified days
   */
  async deleteOlderThan(days: number = 90): Promise<number> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return this.table.where('createdAt').below(cutoff).delete()
  }
}
