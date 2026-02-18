import { getDatabase } from '@/data/database'
import type { FailedSwap } from '@/core/types'

/**
 * Repository for managing failed swap records (retry queue)
 */
export class FailedSwapRepository {
  private get table() {
    return getDatabase().failedSwaps
  }

  /**
   * Save a failed swap (insert or update)
   */
  async save(swap: FailedSwap): Promise<void> {
    await this.table.put(swap)
  }

  /**
   * Add a failed swap (alias for save)
   */
  async add(swap: FailedSwap): Promise<void> {
    await this.save(swap)
  }

  /**
   * Get by ID (alias for findById)
   */
  async getById(id: string): Promise<FailedSwap | null> {
    return this.findById(id)
  }

  /**
   * Get all retryable swaps
   */
  async getRetryable(): Promise<FailedSwap[]> {
    return this.findRetryable()
  }

  /**
   * Find by ID
   */
  async findById(id: string): Promise<FailedSwap | null> {
    const result = await this.table.get(id)
    return result ?? null
  }

  /**
   * Find all failed swaps, sorted by createdAt desc
   */
  async findAll(): Promise<FailedSwap[]> {
    return this.table.orderBy('createdAt').reverse().toArray()
  }

  /**
   * Find retryable swaps
   */
  async findRetryable(): Promise<FailedSwap[]> {
    const results = await this.table.filter(s => s.isRetryable === true).sortBy('createdAt')
    return results.reverse()
  }

  /**
   * Find by mint URL
   */
  async findByMint(mintUrl: string): Promise<FailedSwap[]> {
    return this.table
      .where('mintUrl')
      .equals(mintUrl)
      .reverse()
      .sortBy('createdAt')
  }

  /**
   * Increment attempt count and update lastAttemptAt
   */
  async incrementAttempt(id: string): Promise<void> {
    await this.table.where('id').equals(id).modify((swap) => {
      swap.attemptCount++
      swap.lastAttemptAt = Date.now()
    })
  }

  /**
   * Mark as non-retryable
   */
  async markAsNonRetryable(id: string): Promise<void> {
    await this.table.update(id, { isRetryable: false })
  }

  /**
   * Update a failed swap by ID
   */
  async update(id: string, updates: Partial<Omit<FailedSwap, 'id'>>): Promise<void> {
    await this.table.update(id, updates)
  }

  /**
   * Delete by ID
   */
  async delete(id: string): Promise<void> {
    await this.table.delete(id)
  }

  /**
   * Count all records
   */
  async count(): Promise<number> {
    return this.table.count()
  }

  /**
   * Count retryable records
   */
  async countRetryable(): Promise<number> {
    return this.table.filter(s => s.isRetryable === true).count()
  }

  /**
   * Clean up non-retryable records older than specified days
   */
  async cleanupNonRetryable(days: number = 30): Promise<number> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return this.table
      .filter(s => s.isRetryable === false && s.createdAt < cutoff)
      .delete()
  }
}
