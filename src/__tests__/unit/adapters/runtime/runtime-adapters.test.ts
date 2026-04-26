import { describe, expect, it, vi } from 'vitest'
import { IncomingReviewQueueAdapter } from '@/adapters/runtime/incoming-review-queue.adapter'
import { TrustedMintProviderAdapter } from '@/adapters/runtime/trusted-mint-provider.adapter'
import type { PendingIncomingReview } from '@/core/types'

describe('runtime adapters', () => {
  it('delegates incoming review enqueue through the injected boundary function', async () => {
    const enqueue = vi.fn()
    const adapter = new IncomingReviewQueueAdapter(enqueue)
    const review: PendingIncomingReview = {
      externalId: 'review-1',
      token: { raw: 'cashuA...' } as unknown as PendingIncomingReview['token'],
      queuedAt: Date.now(),
      source: 'gift-wrap',
    }

    await adapter.enqueue(review)

    expect(enqueue).toHaveBeenCalledWith(review)
  })

  it('checks trusted mints through the injected settings reader', async () => {
    const adapter = new TrustedMintProviderAdapter(() => ['https://mint.example.com/'])

    await expect(adapter.hasTrustedMint('https://mint.example.com')).resolves.toBe(true)
    await expect(adapter.hasTrustedMint('https://other.example.com')).resolves.toBe(false)
  })
})
