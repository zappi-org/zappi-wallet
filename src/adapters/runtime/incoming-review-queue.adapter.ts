import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { PendingIncomingReview } from '@/core/types'

export class IncomingReviewQueueAdapter implements IncomingReviewQueue {
  constructor(
    private readonly enqueueReview: (review: PendingIncomingReview) => void | Promise<void>,
  ) {}

  async enqueue(review: PendingIncomingReview): Promise<void> {
    await this.enqueueReview(review)
  }
}
