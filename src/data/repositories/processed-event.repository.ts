import { getDatabase } from '@/data/database'
import type { ProcessedEvent } from '@/core/types'

/**
 * Repository for managing processed event records (deduplication)
 */
export class ProcessedEventRepository {
  private get table() {
    return getDatabase().processedEvents
  }

  /**
   * Save a processed event record
   */
  async save(event: ProcessedEvent): Promise<void> {
    await this.table.put(event)
  }

  /**
   * Mark event as processed (alias for save)
   */
  async markProcessed(event: ProcessedEvent): Promise<void> {
    await this.save(event)
  }

  /**
   * Check if event has been processed (alias for exists)
   */
  async isProcessed(eventId: string): Promise<boolean> {
    return this.exists(eventId)
  }

  /**
   * Get failed processed events
   */
  async getFailed(): Promise<ProcessedEvent[]> {
    return this.table.where('result').equals('failed').toArray()
  }

  /**
   * Find by event ID
   */
  async findByEventId(eventId: string): Promise<ProcessedEvent | null> {
    const result = await this.table.get(eventId)
    return result ?? null
  }

  /**
   * Find by transaction ID
   */
  async findByTxId(txId: string): Promise<ProcessedEvent | null> {
    const result = await this.table.where('txId').equals(txId).first()
    return result ?? null
  }

  /**
   * Check if event ID exists
   */
  async exists(eventId: string): Promise<boolean> {
    const count = await this.table.where('eventId').equals(eventId).count()
    return count > 0
  }

  /**
   * Check if transaction ID exists
   */
  async existsByTxId(txId: string): Promise<boolean> {
    const count = await this.table.where('txId').equals(txId).count()
    return count > 0
  }

  /**
   * Delete by event ID
   */
  async delete(eventId: string): Promise<void> {
    await this.table.delete(eventId)
  }

  /**
   * Delete events older than specified timestamp
   */
  async deleteOlderThan(timestamp: number): Promise<void> {
    await this.table.where('processedAt').below(timestamp).delete()
  }

  /**
   * Count all records
   */
  async count(): Promise<number> {
    return this.table.count()
  }
}
