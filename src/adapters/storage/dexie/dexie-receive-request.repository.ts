import type { ReceiveRequestRepository } from '@/core/ports/driven/receive-request.repository.port'
import type { ReceiveRequest, PaymentMethod } from '@/core/domain/receive-request'
import { expireReceiveRequest } from '@/core/domain/receive-request'
import type { ReceiveRequestRecord } from './schema'
import { getDatabase } from './schema'
import { sat, toNumber } from '@/core/domain/amount'
import { stripTrailingSlash } from '@/utils/url'

function toDomain(r: ReceiveRequestRecord): ReceiveRequest {
  const methods: PaymentMethod[] = [
    { type: 'lightning', ref: r.quoteId, encoded: r.invoice, expiresAt: r.expiresAt },
  ]

  if (r.ecashRequest && r.ecashRequestId) {
    methods.push({
      type: 'ecash',
      ref: r.ecashRequestId,
      encoded: r.ecashRequest,
      expiresAt: r.expiresAt,
      metadata: r.httpEndpoint ? { httpEndpoint: r.httpEndpoint } : undefined,
    })
  }

  return {
    id: r.id,
    amount: sat(r.amount),
    accountId: r.mintUrl,
    status: r.status,
    paymentMethods: methods,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    bip321Uri: r.bip321Uri,
    completedMethod: r.completedMethod,
    completedAt: r.completedAt,
  }
}

function toLegacy(d: ReceiveRequest): ReceiveRequestRecord {
  const ln = d.paymentMethods.find((m) => m.type === 'lightning')
  const ec = d.paymentMethods.find((m) => m.type === 'ecash')

  return {
    id: d.id,
    status: d.status,
    amount: toNumber(d.amount),
    mintUrl: d.accountId,
    createdAt: d.createdAt,
    expiresAt: d.expiresAt,
    quoteId: ln?.ref ?? '',
    invoice: ln?.encoded ?? '',
    ecashRequest: ec?.encoded,
    ecashRequestId: ec?.ref,
    httpEndpoint: (ec?.metadata as Record<string, unknown> | undefined)?.httpEndpoint as
      | string
      | undefined,
    bip321Uri: d.bip321Uri,
    completedAt: d.completedAt,
    completedMethod: d.completedMethod as ReceiveRequestRecord['completedMethod'],
  }
}

export class DexieReceiveRequestRepository implements ReceiveRequestRepository {
  private get db() {
    return getDatabase()
  }

  async save(req: ReceiveRequest): Promise<void> {
    await this.db.receiveRequests.put(toLegacy(req))
  }

  async getById(id: string): Promise<ReceiveRequest | null> {
    const record = await this.db.receiveRequests.get(id)
    return record ? toDomain(record) : null
  }

  async findByPaymentRef(ref: string): Promise<ReceiveRequest | null> {
    const byQuote = await this.db.receiveRequests.where('quoteId').equals(ref).first()
    if (byQuote) return toDomain(byQuote)

    const byEcash = await this.db.receiveRequests.where('ecashRequestId').equals(ref).first()
    if (byEcash) return toDomain(byEcash)

    return null
  }

  async listPending(accountIds?: string[]): Promise<ReceiveRequest[]> {
    const now = Date.now()
    const results = await this.db.receiveRequests.where('status').equals('pending').toArray()
    const normalizedIds = accountIds?.map(stripTrailingSlash)

    return results
      .filter((r) => {
        if (r.expiresAt <= now) return false
        if (normalizedIds && normalizedIds.length > 0) {
          return normalizedIds.includes(stripTrailingSlash(r.mintUrl))
        }
        return true
      })
      .map(toDomain)
  }

  async cleanupExpired(): Promise<number> {
    const now = Date.now()
    const expired = await this.db.receiveRequests
      .where('status')
      .equals('pending')
      .filter((r) => r.expiresAt <= now)
      .toArray()

    if (expired.length === 0) return 0

    const expiredDomains = expired.map(toDomain).map(expireReceiveRequest)
    await this.db.receiveRequests.bulkPut(expiredDomains.map(toLegacy))

    return expired.length
  }
}
