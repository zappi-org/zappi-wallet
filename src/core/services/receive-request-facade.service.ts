import type {
  ReceiveRequestUseCase,
  CreateReceiveRequestParams,
  ReceiveRequestData,
} from '@/core/ports/driving/receive-request.usecase'
import type { ReceiveRequestRepository } from '@/core/ports/driven/receive-request.repository.port'
import type { PaymentMethod, ReceivePaymentMethodType, ReceiveRequest } from '@/core/domain/receive-request'
import {
  cancelReceiveRequest as domainCancel,
  completeReceiveRequest as domainComplete,
  createReceiveMethod,
  createReceiveRequest as domainCreate,
  normalizeReceivePaymentMethodType,
} from '@/core/domain/receive-request'
import { toNumber } from '@/core/domain/amount'
import { ReceiveRequestInvalidError } from '@/core/errors/payment.errors'

export class ReceiveRequestFacadeService implements ReceiveRequestUseCase {
  constructor(private readonly repo: ReceiveRequestRepository) {}

  async create(params: CreateReceiveRequestParams): Promise<ReceiveRequestData> {
    const expiresAt = params.expiresAt ?? Date.now() + 30 * 60 * 1000
    const paymentMethods: PaymentMethod[] = []

    if (params.quoteId && params.bolt11) {
      paymentMethods.push(createReceiveMethod({
        type: 'bolt11',
        ref: params.quoteId,
        encoded: params.bolt11,
        expiresAt,
      }))
    }

    if (params.ecashRequest && params.ecashRequestId) {
      paymentMethods.push(createReceiveMethod({
        type: 'ecash',
        ref: params.ecashRequestId,
        encoded: params.ecashRequest,
        expiresAt,
        ...(params.httpEndpoint && { metadata: { httpEndpoint: params.httpEndpoint } }),
      }))
    }

    if (paymentMethods.length === 0) {
      throw new ReceiveRequestInvalidError('ReceiveRequest requires at least one payment method')
    }

    const req = domainCreate({
      id: params.requestId ?? crypto.randomUUID(),
      amount: params.amount,
      accountId: params.accountId,
      paymentMethods,
      createdAt: Date.now(),
      expiresAt,
      bip321Uri: params.bip321Uri,
    })
    await this.repo.save(req)
    return toData(req)
  }

  async complete(id: string, method: string): Promise<void> {
    const normalized = requireReceiveMethod(method)
    const now = Date.now()
    await this.repo.update(id, (existing) => domainComplete(existing, normalized, now))
  }

  async settleByPaymentRef(paymentRef: string, method: string): Promise<ReceiveRequestData | null> {
    const normalized = requireReceiveMethod(method)
    const now = Date.now()
    const updated = await this.repo.updateByPaymentRef(
      paymentRef,
      (existing) => domainComplete(existing, normalized, now),
    )
    return updated ? toData(updated) : null
  }

  async cancel(id: string): Promise<void> {
    await this.repo.update(id, domainCancel)
  }

  async findByQuoteId(quoteId: string): Promise<ReceiveRequestData | null> {
    const record = await this.repo.findByPaymentRef(quoteId)
    if (!record) return null
    return toData(record)
  }

  async findByRequestId(requestId: string): Promise<ReceiveRequestData | null> {
    const record = await this.repo.findByPaymentRef(requestId)
    if (!record) return null
    return toData(record)
  }

  async getPending(accountIds?: string[]): Promise<ReceiveRequestData[]> {
    const records = await this.repo.listPending(accountIds)
    return records.map(toData)
  }

  cleanupExpired(): Promise<number> {
    return this.repo.cleanupExpired()
  }
}

function requireReceiveMethod(method: string): ReceivePaymentMethodType {
  const normalized = normalizeReceivePaymentMethodType(method)
  if (!normalized) {
    throw new ReceiveRequestInvalidError(`Unsupported receive method: ${method}`)
  }
  return normalized
}

function toData(req: ReceiveRequest): ReceiveRequestData {
  const bolt11 = req.paymentMethods.find((method) => method.type === 'bolt11')
  const ecash = req.paymentMethods.find((method) => method.type === 'ecash')

  return {
    id: req.id,
    accountId: req.accountId,
    amount: toNumber(req.amount),
    fulfillmentStatus: req.fulfillmentStatus,
    quoteId: bolt11?.ref,
    bolt11: bolt11?.encoded,
    httpEndpoint: (ecash?.metadata as Record<string, unknown> | undefined)?.httpEndpoint as
      | string
      | undefined,
    createdAt: req.createdAt,
    fulfilledAt: req.fulfilledAt,
    fulfilledBy: req.fulfilledBy,
  }
}
