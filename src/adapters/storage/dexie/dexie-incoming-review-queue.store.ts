import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { PendingIncomingReview } from '@/core/types'
import type { Unit } from '@/core/domain/amount'
import { mintUrlKey } from '@/utils/url'
import { getDatabase, type IncomingReviewRecord } from './schema'

/**
 * Dexie-backed incoming review queue.
 *
 * The old in-memory (Zustand) queue lost reviews on refresh/crash — if the watcher
 * had already marked 'pending' in processedStore, replay would be deduped and the
 * token lost permanently. This adapter treats IndexedDB as the source of truth and
 * demotes Zustand to a UI mirror (notify callbacks). Durable once enqueue/remove resolves.
 */
export class DexieIncomingReviewQueue implements IncomingReviewQueue {
  constructor(
    private readonly notify?: {
      onEnqueued?: (review: PendingIncomingReview) => void
      onRemoved?: (externalId: string) => void
    },
  ) {}

  async enqueue(review: PendingIncomingReview): Promise<void> {
    // Durable first (PK=externalId — put is idempotent), UI mirror after
    await getDatabase().incomingReviews.put(toRecord(review))
    this.notify?.onEnqueued?.(review)
  }

  async listAll(): Promise<PendingIncomingReview[]> {
    const records = await getDatabase().incomingReviews.orderBy('queuedAt').toArray()
    return records.map(fromRecord)
  }

  async listByMint(mintUrl: string): Promise<PendingIncomingReview[]> {
    // Normalized-comparison scan rather than an index lookup — a queue row's mintUrl is
    // the raw value the sender's wallet encoded into the token, so its :443, case, and
    // trailing-slash notation may differ from the lookup side (the settings' normalized
    // URL). The queue is small, so a full scan is negligible.
    const target = normalizeMintKey(mintUrl)
    const records = await getDatabase().incomingReviews.orderBy('queuedAt').toArray()
    return records.filter((r) => normalizeMintKey(r.mintUrl) === target).map(fromRecord)
  }

  async remove(externalId: string): Promise<void> {
    await getDatabase().incomingReviews.delete(externalId)
    this.notify?.onRemoved?.(externalId)
  }
}

// Mint-identity comparison key — converges on the app-wide canonical (mintUrlKey).
// Storage stays raw and only comparison keys, so existing rows remain compatible.
// Delta from the old local key: path case is now preserved (paths are case-sensitive resources).
function normalizeMintKey(mintUrl: string): string {
  return mintUrlKey(mintUrl)
}

// bigint has structured-clone differences across IDB implementations, so round-trip it as a string
function toRecord(review: PendingIncomingReview): IncomingReviewRecord {
  return {
    externalId: review.externalId,
    mintUrl: review.token.mintUrl,
    token: review.token.token,
    amountValue: review.token.amount.value.toString(),
    amountUnit: review.token.amount.unit,
    memo: review.token.memo,
    queuedAt: review.queuedAt,
    requestId: review.requestId,
    senderPubkey: review.senderPubkey,
    txId: review.txId,
    source: review.source,
  }
}

function fromRecord(record: IncomingReviewRecord): PendingIncomingReview {
  return {
    externalId: record.externalId,
    token: {
      type: 'cashu-token',
      token: record.token,
      amount: { value: BigInt(record.amountValue), unit: record.amountUnit as Unit },
      mintUrl: record.mintUrl,
      memo: record.memo,
    },
    queuedAt: record.queuedAt,
    requestId: record.requestId,
    senderPubkey: record.senderPubkey,
    txId: record.txId,
    source: record.source,
  }
}
