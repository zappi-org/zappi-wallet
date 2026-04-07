import type { FailedIncoming } from '@/core/types'

export interface FailedIncomingStore {
  save(item: FailedIncoming): Promise<void>
  getRetryable(): Promise<FailedIncoming[]>
  update(id: string, data: Partial<FailedIncoming>): Promise<void>
  delete(id: string): Promise<void>
  findAll(): Promise<FailedIncoming[]>
  markAsNonRetryable(id: string): Promise<void>
  cleanupNonRetryable(daysOld: number): Promise<void>
}
