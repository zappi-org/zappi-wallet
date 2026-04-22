import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { PendingIncomingReview } from '@/core/types'
import { useAppStore } from '@/store'

export class IncomingReviewQueueAdapter implements IncomingReviewQueue {
  async enqueue(review: PendingIncomingReview): Promise<void> {
    useAppStore.getState().enqueueIncomingReview(review)
  }
}
