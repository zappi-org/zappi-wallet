import type { FailedIncomingStore } from '@/core/ports/driven/failed-incoming-store.port'
import type { FailedIncoming } from '@/core/types'
import { getDatabase } from './dexie/schema'

export class FailedIncomingStoreAdapter implements FailedIncomingStore {
  private get table() {
    return getDatabase().failedIncomings
  }

  async save(item: FailedIncoming): Promise<void> {
    await this.table.put(item)
  }

  async getRetryable(): Promise<FailedIncoming[]> {
    const results = await this.table.filter((s) => s.isRetryable === true).sortBy('createdAt')
    return results.reverse()
  }

  async update(id: string, data: Partial<FailedIncoming>): Promise<void> {
    await this.table.update(id, data)
  }

  async delete(id: string): Promise<void> {
    await this.table.delete(id)
  }

  async findAll(): Promise<FailedIncoming[]> {
    return this.table.orderBy('createdAt').reverse().toArray()
  }

  async markAsNonRetryable(id: string): Promise<void> {
    await this.table.update(id, { isRetryable: false })
  }

  async cleanupNonRetryable(daysOld: number): Promise<void> {
    const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000
    await this.table.filter((s) => s.isRetryable === false && s.createdAt < cutoff).delete()
  }
}
