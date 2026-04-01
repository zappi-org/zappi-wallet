import type { PendingOperation } from '@/core/domain/pending-operation'

export interface PendingOperationRepository {
  list(): Promise<PendingOperation[]>
  listByAccount(accountId: string): Promise<PendingOperation[]>
  delete(id: string): Promise<void>
  deleteExpired(maxAgeMs: number): Promise<number>
  count(): Promise<number>
}
