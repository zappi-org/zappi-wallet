import type { ReceiveRequestRepository } from '@/core/ports/driven/receive-request.repository.port'
import type {
  FulfillmentStatus,
  MethodStatus,
  PaymentMethod,
  ReceivePaymentMethodType,
  ReceiveRequest,
} from '@/core/domain/receive-request'
import {
  expireMethodsByTime,
  fulfillmentFromLegacyStatus,
  legacyStatusFromFulfillment,
  normalizeReceivePaymentMethodType,
} from '@/core/domain/receive-request'
import type {
  ReceiveRequestPaymentMethodRecord,
  ReceiveRequestRecord,
} from './schema'
import { getDatabase } from './schema'
import { sat, toNumber } from '@/core/domain/amount'

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

function legacyMethodStatus(
  record: ReceiveRequestRecord,
  method: ReceivePaymentMethodType,
): MethodStatus {
  const fulfillmentStatus = getFulfillmentStatus(record)
  if (fulfillmentStatus === 'expired' || fulfillmentStatus === 'cancelled') return 'expired'

  const completedMethod = record.fulfilledBy
    ?? normalizeReceivePaymentMethodType(record.completedMethod ?? '')
  if (completedMethod === method) return 'received'

  return 'active'
}

function getFulfillmentStatus(record: ReceiveRequestRecord): FulfillmentStatus {
  if (record.fulfillmentStatus) return record.fulfillmentStatus
  return fulfillmentFromLegacyStatus(record.status)
}

function normalizeMethodRecord(method: ReceiveRequestPaymentMethodRecord): PaymentMethod {
  return {
    type: method.type,
    status: method.status,
    encoded: method.encoded,
    expiresAt: method.expiresAt,
    ref: method.ref,
    receivedAt: method.receivedAt,
    metadata: method.metadata,
  }
}

function legacyMethods(record: ReceiveRequestRecord): PaymentMethod[] {
  const methods: PaymentMethod[] = []

  if (record.quoteId && record.invoice) {
    methods.push({
      type: 'bolt11',
      status: legacyMethodStatus(record, 'bolt11'),
      ref: record.quoteId,
      encoded: record.invoice,
      expiresAt: record.expiresAt,
      receivedAt: legacyMethodStatus(record, 'bolt11') === 'received'
        ? record.fulfilledAt ?? record.completedAt
        : undefined,
    })
  }

  if (record.ecashRequest && record.ecashRequestId) {
    methods.push({
      type: 'ecash',
      status: legacyMethodStatus(record, 'ecash'),
      ref: record.ecashRequestId,
      encoded: record.ecashRequest,
      expiresAt: record.expiresAt,
      receivedAt: legacyMethodStatus(record, 'ecash') === 'received'
        ? record.fulfilledAt ?? record.completedAt
        : undefined,
      metadata: record.httpEndpoint ? { httpEndpoint: record.httpEndpoint } : undefined,
    })
  }

  return methods
}

function toDomain(record: ReceiveRequestRecord): ReceiveRequest {
  const fulfilledBy = record.fulfilledBy
    ?? normalizeReceivePaymentMethodType(record.completedMethod ?? '')
    ?? undefined
  const paymentMethods = record.paymentMethods?.map(normalizeMethodRecord) ?? legacyMethods(record)

  return {
    id: record.id,
    amount: sat(record.amount),
    accountId: record.mintUrl,
    fulfillmentStatus: getFulfillmentStatus(record),
    paymentMethods,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    memo: record.memo,
    bip321Uri: record.bip321Uri,
    fulfilledBy,
    fulfilledAt: record.fulfilledAt ?? record.completedAt,
  }
}

function toMethodRecord(method: PaymentMethod): ReceiveRequestPaymentMethodRecord {
  return {
    type: method.type,
    status: method.status,
    encoded: method.encoded,
    expiresAt: method.expiresAt,
    ref: method.ref,
    receivedAt: method.receivedAt,
    metadata: method.metadata,
  }
}

function toLegacy(domain: ReceiveRequest): ReceiveRequestRecord {
  const bolt11 = domain.paymentMethods.find((method) => method.type === 'bolt11')
  const ecash = domain.paymentMethods.find((method) => method.type === 'ecash')

  return {
    id: domain.id,
    status: legacyStatusFromFulfillment(domain.fulfillmentStatus),
    fulfillmentStatus: domain.fulfillmentStatus,
    amount: toNumber(domain.amount),
    memo: domain.memo,
    mintUrl: domain.accountId,
    createdAt: domain.createdAt,
    expiresAt: domain.expiresAt,
    paymentMethods: domain.paymentMethods.map(toMethodRecord),
    quoteId: bolt11?.ref ?? '',
    invoice: bolt11?.encoded ?? '',
    ecashRequest: ecash?.encoded,
    ecashRequestId: ecash?.ref,
    httpEndpoint: (ecash?.metadata as Record<string, unknown> | undefined)?.httpEndpoint as
      | string
      | undefined,
    bip321Uri: domain.bip321Uri,
    completedAt: domain.fulfilledAt,
    completedMethod: domain.fulfilledBy,
    fulfilledAt: domain.fulfilledAt,
    fulfilledBy: domain.fulfilledBy,
  }
}

function matchesAccount(record: ReceiveRequestRecord, accountIds?: string[]): boolean {
  if (!accountIds || accountIds.length === 0) return true
  const normalizedIds = accountIds.map(stripTrailingSlash)
  return normalizedIds.includes(stripTrailingSlash(record.mintUrl))
}

function findMethodByRef(record: ReceiveRequestRecord, ref: string): boolean {
  if (record.quoteId === ref || record.ecashRequestId === ref) return true
  return record.paymentMethods?.some((method) => method.ref === ref) ?? false
}

export class DexieReceiveRequestRepository implements ReceiveRequestRepository {
  private get db() {
    return getDatabase()
  }

  async save(req: ReceiveRequest): Promise<void> {
    await this.db.receiveRequests.put(toLegacy(req))
  }

  async update(
    id: string,
    updater: (request: ReceiveRequest) => ReceiveRequest,
  ): Promise<ReceiveRequest | null> {
    return this.db.transaction('rw', this.db.receiveRequests, async () => {
      const record = await this.db.receiveRequests.get(id)
      if (!record) return null

      const existing = toDomain(record)
      const next = updater(existing)
      if (next !== existing) {
        await this.db.receiveRequests.put(toLegacy(next))
      }
      return next
    })
  }

  async updateByPaymentRef(
    ref: string,
    updater: (request: ReceiveRequest) => ReceiveRequest,
  ): Promise<ReceiveRequest | null> {
    return this.db.transaction('rw', this.db.receiveRequests, async () => {
      const record = await this.findRecordByPaymentRef(ref)
      if (!record) return null

      const existing = toDomain(record)
      const next = updater(existing)
      if (next !== existing) {
        await this.db.receiveRequests.put(toLegacy(next))
      }
      return next
    })
  }

  async getById(id: string): Promise<ReceiveRequest | null> {
    const record = await this.db.receiveRequests.get(id)
    return record ? toDomain(record) : null
  }

  async findByPaymentRef(ref: string): Promise<ReceiveRequest | null> {
    const record = await this.findRecordByPaymentRef(ref)
    return record ? toDomain(record) : null
  }

  async listAll(accountIds?: string[]): Promise<ReceiveRequest[]> {
    const results = await this.db.receiveRequests.toArray()
    return results.filter((record) => matchesAccount(record, accountIds)).map(toDomain)
  }

  async listPending(accountIds?: string[]): Promise<ReceiveRequest[]> {
    const now = Date.now()
    const results = await this.listAll(accountIds)
    return results.filter((request) =>
      request.fulfillmentStatus === 'pending' &&
      request.expiresAt > now &&
      request.paymentMethods.some((method) => method.status === 'active' && method.expiresAt > now),
    )
  }

  async cleanupExpired(): Promise<number> {
    const now = Date.now()
    const records = await this.db.receiveRequests.toArray()
    let changed = 0

    for (const record of records) {
      let didChange = false
      await this.update(record.id, (existing) => {
        const next = expireMethodsByTime(existing, now)
        didChange = next !== existing
        return next
      })
      if (didChange) changed += 1
    }

    return changed
  }

  private async findRecordByPaymentRef(ref: string): Promise<ReceiveRequestRecord | undefined> {
    const byQuote = await this.db.receiveRequests.where('quoteId').equals(ref).first()
    if (byQuote) return byQuote

    const byEcash = await this.db.receiveRequests.where('ecashRequestId').equals(ref).first()
    if (byEcash) return byEcash

    const all = await this.db.receiveRequests.toArray()
    return all.find((record) => findMethodByRef(record, ref))
  }
}
