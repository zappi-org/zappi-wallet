import type { PendingIncomingReview } from '@/core/types'

export interface IncomingReviewQueue {
  enqueue(review: PendingIncomingReview): Promise<void>
}
