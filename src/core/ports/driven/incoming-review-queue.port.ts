import type { PendingIncomingReview } from '@/core/types'

/**
 * Review queue for incoming payments from untrusted mints.
 *
 * Persistence contract: enqueue resolves only after durable storage completes — the
 * caller (watcher/recovery) must mark processed **after** enqueue succeeds so no token
 * is lost across a crash. externalId is the PK, so duplicate enqueues are idempotent.
 */
export interface IncomingReviewQueue {
  enqueue(review: PendingIncomingReview): Promise<void>
  /** Full list for boot hydration (queuedAt ascending) */
  listAll(): Promise<PendingIncomingReview[]>
  /** For drainReviewQueue — query includes trailing-slash variants */
  listByMint(mintUrl: string): Promise<PendingIncomingReview[]>
  /** Remove on user approve/reject or successful drain (no-op if absent) */
  remove(externalId: string): Promise<void>
}
