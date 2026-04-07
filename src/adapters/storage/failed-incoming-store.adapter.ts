import type { FailedIncomingStore } from '@/core/ports/driven/failed-incoming-store.port'
import type { FailedIncoming } from '@/core/types'
import { FailedIncomingRepository } from '@/data/repositories/failed-incoming.repository'

export class FailedIncomingStoreAdapter implements FailedIncomingStore {
  private repo = new FailedIncomingRepository()

  async save(item: FailedIncoming): Promise<void> {
    return this.repo.save(item)
  }

  async getRetryable(): Promise<FailedIncoming[]> {
    return this.repo.getRetryable()
  }

  async update(id: string, data: Partial<FailedIncoming>): Promise<void> {
    return this.repo.update(id, data)
  }

  async delete(id: string): Promise<void> {
    return this.repo.delete(id)
  }

  async findAll(): Promise<FailedIncoming[]> {
    return this.repo.findAll()
  }

  async markAsNonRetryable(id: string): Promise<void> {
    return this.repo.markAsNonRetryable(id)
  }

  async cleanupNonRetryable(daysOld: number): Promise<void> {
    await this.repo.cleanupNonRetryable(daysOld)
  }
}
