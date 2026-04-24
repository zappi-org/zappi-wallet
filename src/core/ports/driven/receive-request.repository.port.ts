import type { ReceiveRequest } from '@/core/domain/receive-request'

export interface ReceiveRequestRepository {
  save(req: ReceiveRequest): Promise<void>
  update(
    id: string,
    updater: (request: ReceiveRequest) => ReceiveRequest,
  ): Promise<ReceiveRequest | null>
  updateByPaymentRef(
    ref: string,
    updater: (request: ReceiveRequest) => ReceiveRequest,
  ): Promise<ReceiveRequest | null>
  getById(id: string): Promise<ReceiveRequest | null>
  findByPaymentRef(ref: string): Promise<ReceiveRequest | null>
  listAll(accountIds?: string[]): Promise<ReceiveRequest[]>
  listPending(accountIds?: string[]): Promise<ReceiveRequest[]>
  cleanupExpired(): Promise<number>
}
