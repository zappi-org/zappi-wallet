import type {
  ReceiveRequestUseCase,
  CreateReceiveRequestParams,
  ReceiveRequestData,
} from '@/core/ports/driving/receive-request.usecase'
import type { ReceiveRequestRepository } from '@/core/ports/driven/receive-request.repository.port'
import {
  createReceiveRequest as domainCreate,
  completeReceiveRequest as domainComplete,
  cancelReceiveRequest as domainCancel,
} from '@/core/domain/receive-request'
import { toNumber } from '@/core/domain/amount'

export class ReceiveRequestFacadeService implements ReceiveRequestUseCase {
  constructor(private readonly repo: ReceiveRequestRepository) {}

  async create(params: CreateReceiveRequestParams): Promise<ReceiveRequestData> {
    const req = domainCreate({
      id: params.requestId ?? crypto.randomUUID(),
      amount: params.amount,
      accountId: params.accountId,
      paymentMethods: [],
      expiresAt: Date.now() + 30 * 60 * 1000,
      bip321Uri: params.httpEndpoint,
    })
    await this.repo.save(req)
    return toData(req)
  }

  async complete(id: string, method: string): Promise<void> {
    const existing = await this.repo.getById(id)
    if (!existing) return
    const completed = domainComplete(existing, method)
    await this.repo.save(completed)
  }

  async cancel(id: string): Promise<void> {
    const existing = await this.repo.getById(id)
    if (!existing) return
    const cancelled = domainCancel(existing)
    await this.repo.save(cancelled)
  }

  async findByQuoteId(quoteId: string): Promise<ReceiveRequestData | null> {
    const record = await this.repo.findByPaymentRef(quoteId)
    if (!record) return null
    return toData(record)
  }

  async findByRequestId(requestId: string): Promise<ReceiveRequestData | null> {
    return this.findByQuoteId(requestId)
  }

  async getPending(accountIds?: string[]): Promise<ReceiveRequestData[]> {
    const records = await this.repo.listPending(accountIds)
    return records.map(toData)
  }

  cleanupExpired(): Promise<number> {
    return this.repo.cleanupExpired()
  }
}

function toData(req: { id: string; accountId: string; amount: { value: bigint; unit: string }; status: string; createdAt: number; completedAt?: number }): ReceiveRequestData {
  return {
    id: req.id,
    accountId: req.accountId,
    adapterId: '',
    amount: toNumber(req.amount as { value: bigint; unit: 'sat' | 'msat' | 'usd' | 'eur' }),
    status: req.status as ReceiveRequestData['status'],
    createdAt: req.createdAt,
    completedAt: req.completedAt,
  }
}
