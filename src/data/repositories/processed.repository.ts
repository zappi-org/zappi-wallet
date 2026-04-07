import { getDatabase } from '@/data/database'
import type { ProcessedRecord } from '@/core/types'

/**
 * Repository for managing processed records (deduplication)
 */
export class ProcessedRepository {
  private get table() {
    return getDatabase().processedRecords
  }

  async save(record: ProcessedRecord): Promise<void> {
    await this.table.put(record)
  }

  async markProcessed(record: ProcessedRecord): Promise<void> {
    await this.save(record)
  }

  async isProcessed(externalId: string): Promise<boolean> {
    return this.exists(externalId)
  }

  async getFailed(): Promise<ProcessedRecord[]> {
    return this.table.where('result').equals('failed').toArray()
  }

  async findById(externalId: string): Promise<ProcessedRecord | null> {
    const result = await this.table.get(externalId)
    return result ?? null
  }

  async findByTxId(txId: string): Promise<ProcessedRecord | null> {
    const result = await this.table.where('txId').equals(txId).first()
    return result ?? null
  }

  async exists(externalId: string): Promise<boolean> {
    const count = await this.table.where('externalId').equals(externalId).count()
    return count > 0
  }

  async existsByTxId(txId: string): Promise<boolean> {
    const count = await this.table.where('txId').equals(txId).count()
    return count > 0
  }

  async delete(externalId: string): Promise<void> {
    await this.table.delete(externalId)
  }

  async deleteOlderThan(timestamp: number): Promise<void> {
    await this.table.where('processedAt').below(timestamp).delete()
  }

  async count(): Promise<number> {
    return this.table.count()
  }
}
