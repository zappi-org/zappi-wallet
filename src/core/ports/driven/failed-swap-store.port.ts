import type { FailedSwap } from '@/core/types'

export interface FailedSwapStore {
  save(swap: FailedSwap): Promise<void>
  getRetryable(): Promise<FailedSwap[]>
  update(id: string, data: Partial<FailedSwap>): Promise<void>
  delete(id: string): Promise<void>
  findAll(): Promise<FailedSwap[]>
  markAsNonRetryable(id: string): Promise<void>
  cleanupNonRetryable(daysOld: number): Promise<void>
}
