/**
 * DexieIncomingReviewQueue — 미신뢰 민트 review 영속 대기열 (설계 §6.2 / 리뷰 #3)
 *
 * 핵심 불변식:
 * - enqueue는 durable(put) 완료 후 notify — Zustand는 미러일 뿐
 * - externalId PK로 재-enqueue 멱등 (crash-replay 시나리오의 전제)
 * - bigint amount가 문자열 왕복 후에도 보존된다 (IDB structured clone 편차 회피)
 * - listByMint는 trailing slash 변형을 흡수한다
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DexieIncomingReviewQueue } from '@/adapters/storage/dexie/dexie-incoming-review-queue.store'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'
import type { PendingIncomingReview } from '@/core/types'

function makeReview(overrides: Partial<PendingIncomingReview> = {}): PendingIncomingReview {
  return {
    externalId: 'event-1',
    token: {
      type: 'cashu-token',
      token: 'cashuA...',
      amount: { value: 21n, unit: 'sat' },
      mintUrl: 'https://mint.test',
      memo: 'hi',
    },
    queuedAt: 1_000,
    requestId: 'req-1',
    senderPubkey: 'pk-sender',
    txId: 'tx-1',
    source: 'gift-wrap',
    ...overrides,
  }
}

describe('DexieIncomingReviewQueue', () => {
  let queue: DexieIncomingReviewQueue
  let onEnqueued: (review: PendingIncomingReview) => void
  let onRemoved: (externalId: string) => void

  beforeEach(async () => {
    await resetDatabase()
    onEnqueued = vi.fn()
    onRemoved = vi.fn()
    queue = new DexieIncomingReviewQueue({ onEnqueued, onRemoved })
  })

  afterEach(async () => {
    await resetDatabase()
  })

  it('enqueue persists durably then notifies the UI mirror', async () => {
    const review = makeReview()

    await queue.enqueue(review)

    expect(await getDatabase().incomingReviews.get('event-1')).toBeTruthy()
    expect(onEnqueued).toHaveBeenCalledWith(review)
  })

  it('round-trips every field including the bigint amount', async () => {
    const review = makeReview()
    await queue.enqueue(review)

    const [loaded] = await queue.listAll()

    expect(loaded).toEqual(review)
    expect(loaded.token.amount.value).toBe(21n)
  })

  it('re-enqueue with the same externalId is idempotent (crash replay)', async () => {
    await queue.enqueue(makeReview())
    await queue.enqueue(makeReview({ queuedAt: 2_000 }))

    const all = await queue.listAll()
    expect(all).toHaveLength(1)
    expect(all[0].queuedAt).toBe(2_000)
  })

  it('listByMint absorbs trailing-slash variants and sorts by queuedAt', async () => {
    await queue.enqueue(makeReview({ externalId: 'b', queuedAt: 2 }))
    await queue.enqueue(
      makeReview({
        externalId: 'a',
        queuedAt: 1,
        token: { ...makeReview().token, mintUrl: 'https://mint.test/' },
      }),
    )
    await queue.enqueue(
      makeReview({
        externalId: 'other',
        token: { ...makeReview().token, mintUrl: 'https://other.mint' },
      }),
    )

    const reviews = await queue.listByMint('https://mint.test/')

    expect(reviews.map((r) => r.externalId)).toEqual(['a', 'b'])
  })

  it('listByMint absorbs :443/host-case variants; path case is preserved (Phase 2 canonical)', async () => {
    await queue.enqueue(
      makeReview({
        externalId: 'variant',
        token: { ...makeReview().token, mintUrl: 'https://Mint.Test:443/' },
      }),
    )
    await queue.enqueue(
      makeReview({
        externalId: 'path-case',
        token: { ...makeReview().token, mintUrl: 'https://mint.test/API' },
      }),
    )

    const matched = await queue.listByMint('https://mint.test')
    expect(matched.map((r) => r.externalId)).toEqual(['variant'])

    // 경로 대소문자는 구분 자원 — 별개 민트로 남는다
    const pathMatched = await queue.listByMint('https://mint.test/api')
    expect(pathMatched).toEqual([])
  })

  it('remove deletes the row and notifies; removing a missing id is a no-op', async () => {
    await queue.enqueue(makeReview())

    await queue.remove('event-1')
    expect(await queue.listAll()).toHaveLength(0)
    expect(onRemoved).toHaveBeenCalledWith('event-1')

    await expect(queue.remove('missing')).resolves.toBeUndefined()
  })

  it('optional fields survive a round-trip as undefined', async () => {
    await queue.enqueue(
      makeReview({
        requestId: undefined,
        senderPubkey: undefined,
        txId: undefined,
        token: { type: 'cashu-token', token: 't', amount: { value: 1n, unit: 'sat' }, mintUrl: 'https://m' },
        source: 'recovery',
      }),
    )

    const [loaded] = await queue.listAll()
    expect(loaded.requestId).toBeUndefined()
    expect(loaded.senderPubkey).toBeUndefined()
    expect(loaded.txId).toBeUndefined()
    expect(loaded.token.memo).toBeUndefined()
    expect(loaded.source).toBe('recovery')
  })
})
