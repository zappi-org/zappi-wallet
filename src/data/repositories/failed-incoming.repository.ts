import { getDatabase } from '@/data/database'
import type { FailedIncomingRecord } from '@/data/database/schema'

/**
 * Repository for managing failed incoming records (retry queue)
 */
export class FailedIncomingRepository {
  private get table() {
    return getDatabase().failedIncomings
  }

  async save(item: FailedIncomingRecord): Promise<void> {
    await this.table.put(item)
  }

  async add(item: FailedIncomingRecord): Promise<void> {
    await this.save(item)
  }

  async getById(id: string): Promise<FailedIncomingRecord | null> {
    return this.findById(id)
  }

  async getRetryable(): Promise<FailedIncomingRecord[]> {
    return this.findRetryable()
  }

  async findById(id: string): Promise<FailedIncomingRecord | null> {
    const result = await this.table.get(id)
    return result ?? null
  }

  async findAll(): Promise<FailedIncomingRecord[]> {
    return this.table.orderBy('createdAt').reverse().toArray()
  }

  async findRetryable(): Promise<FailedIncomingRecord[]> {
    const results = await this.table.filter(s => s.isRetryable === true).sortBy('createdAt')
    return results.reverse()
  }

  async findByAccount(accountId: string): Promise<FailedIncomingRecord[]> {
    return this.table
      .where('accountId')
      .equals(accountId)
      .reverse()
      .sortBy('createdAt')
  }

  async incrementAttempt(id: string): Promise<void> {
    await this.table.where('id').equals(id).modify((item) => {
      item.attemptCount++
      item.lastAttemptAt = Date.now()
    })
  }

  async markAsNonRetryable(id: string): Promise<void> {
    await this.table.update(id, { isRetryable: false })
  }

  async update(id: string, updates: Partial<Omit<FailedIncomingRecord, 'id'>>): Promise<void> {
    await this.table.update(id, updates)
  }

  async delete(id: string): Promise<void> {
    await this.table.delete(id)
  }

  async count(): Promise<number> {
    return this.table.count()
  }

  async countRetryable(): Promise<number> {
    return this.table.filter(s => s.isRetryable === true).count()
  }

  async cleanupNonRetryable(days: number = 30): Promise<number> {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
    return this.table
      .filter(s => s.isRetryable === false && s.createdAt < cutoff)
      .delete()
  }
}
