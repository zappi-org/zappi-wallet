import type { ReceiveRequest } from '@/core/domain/receive-request'

export interface ReceiveRequestRepository {
  save(req: ReceiveRequest): Promise<void>
  getById(id: string): Promise<ReceiveRequest | null>
  findByPaymentRef(ref: string): Promise<ReceiveRequest | null>
  listPending(accountIds?: string[]): Promise<ReceiveRequest[]>
  cleanupExpired(): Promise<number>
}
