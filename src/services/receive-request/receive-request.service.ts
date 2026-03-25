import { getDatabase, type ReceiveRequestRecord } from '@/data/database/schema'
import { stripTrailingSlash } from '@/utils/url'

/**
 * ReceiveRequest service — manages the lifecycle of receive requests.
 *
 * A ReceiveRequest is the source of truth for pending receive items.
 * It owns both Lightning (coco quote) and NUT-18 (ecash) payment methods.
 * Coco mint quotes are used for Lightning minting but not for display.
 */

export interface CreateReceiveRequestParams {
  id: string
  amount: number
  mintUrl: string
  expiresAt: number
  // Lightning
  quoteId: string
  invoice: string
  // NUT-18 (optional)
  ecashRequest?: string
  ecashRequestId?: string
  httpEndpoint?: string
  // BIP-321
  bip321Uri?: string
}

export async function createReceiveRequest(params: CreateReceiveRequestParams): Promise<ReceiveRequestRecord> {
  const db = getDatabase()
  const record: ReceiveRequestRecord = {
    ...params,
    status: 'pending',
    createdAt: Date.now(),
  }
  await db.receiveRequests.put(record)
  return record
}

export async function completeReceiveRequest(
  id: string,
  method: 'lightning' | 'ecash',
): Promise<void> {
  const db = getDatabase()
  await db.receiveRequests.update(id, {
    status: 'completed',
    completedAt: Date.now(),
    completedMethod: method,
  })
}

export async function cancelReceiveRequest(id: string): Promise<void> {
  const db = getDatabase()
  await db.receiveRequests.update(id, {
    status: 'cancelled',
  })
}

export async function getPendingReceiveRequests(mintUrls?: string[]): Promise<ReceiveRequestRecord[]> {
  const db = getDatabase()
  const now = Date.now()
  const results = await db.receiveRequests.where('status').equals('pending').toArray()
  const normalizedMints = mintUrls?.map(stripTrailingSlash)

  return results.filter((r) => {
    if (r.expiresAt <= now) return false
    if (normalizedMints && normalizedMints.length > 0) {
      return normalizedMints.includes(stripTrailingSlash(r.mintUrl))
    }
    return true
  })
}

export async function findByQuoteId(quoteId: string): Promise<ReceiveRequestRecord | undefined> {
  const db = getDatabase()
  return db.receiveRequests.where('quoteId').equals(quoteId).first()
}

export async function findByEcashRequestId(requestId: string): Promise<ReceiveRequestRecord | undefined> {
  const db = getDatabase()
  return db.receiveRequests.where('ecashRequestId').equals(requestId).first()
}

/**
 * Find and complete a pending ReceiveRequest by ecash request ID.
 * No-op if not found or already completed. Safe for fire-and-forget.
 */
export async function completeByEcashRequestId(requestId: string): Promise<void> {
  const req = await findByEcashRequestId(requestId)
  if (req && req.status === 'pending') {
    await completeReceiveRequest(req.id, 'ecash')
  }
}

export async function getReceiveRequest(id: string): Promise<ReceiveRequestRecord | undefined> {
  const db = getDatabase()
  return db.receiveRequests.get(id)
}

export async function cleanupExpired(): Promise<number> {
  const db = getDatabase()
  const now = Date.now()
  const expired = await db.receiveRequests
    .where('status').equals('pending')
    .filter((r) => r.expiresAt <= now)
    .toArray()

  if (expired.length === 0) return 0

  await db.receiveRequests.bulkUpdate(
    expired.map((r) => ({
      key: r.id,
      changes: { status: 'expired' },
    })),
  )

  return expired.length
}

/**
 * Get pending requests that have HTTP endpoints for background recovery.
 * Used by nut18-recovery for HTTP transport background recovery.
 */
export async function getPendingHttpReceiveRequests(): Promise<ReceiveRequestRecord[]> {
  const db = getDatabase()
  const pending = await db.receiveRequests.where('status').equals('pending').toArray()
  return pending.filter((r) => r.httpEndpoint && r.ecashRequestId)
}
