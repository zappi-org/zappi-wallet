import type { FailedSwapStore } from '@/core/ports/driven/failed-swap-store.port'
import type { FailedSwap } from '@/core/types'
import { FailedSwapRepository } from '@/data/repositories/failed-swap.repository'

export class FailedSwapStoreAdapter implements FailedSwapStore {
  private repo = new FailedSwapRepository()

  async save(swap: FailedSwap): Promise<void> {
    return this.repo.save(swap)
  }

  async getRetryable(): Promise<FailedSwap[]> {
    return this.repo.getRetryable()
  }

  async update(id: string, data: Partial<FailedSwap>): Promise<void> {
    return this.repo.update(id, data)
  }

  async delete(id: string): Promise<void> {
    return this.repo.delete(id)
  }

  async findAll(): Promise<FailedSwap[]> {
    return this.repo.findAll()
  }

  async markAsNonRetryable(id: string): Promise<void> {
    return this.repo.markAsNonRetryable(id)
  }

  async cleanupNonRetryable(daysOld: number): Promise<void> {
    await this.repo.cleanupNonRetryable(daysOld)
  }
}
