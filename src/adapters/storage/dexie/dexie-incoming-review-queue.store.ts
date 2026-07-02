import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { PendingIncomingReview } from '@/core/types'
import type { Unit } from '@/core/domain/amount'
import { getDatabase, type IncomingReviewRecord } from './schema'

/**
 * Dexie 기반 incoming review 대기열 (설계 §6.2 / 리뷰 #3).
 *
 * 기존 메모리(Zustand) 큐는 새로고침·크래시에 review를 유실했다 — watcher가
 * processedStore에 'pending'을 마킹한 뒤였다면 replay도 dedup에 걸려 토큰이
 * 영구 유실된다. 이 어댑터는 IndexedDB를 원천으로 삼고, Zustand는 UI 미러로
 * 강등한다(notify 콜백). enqueue/remove가 resolve하는 시점에 durable 완료.
 */
export class DexieIncomingReviewQueue implements IncomingReviewQueue {
  constructor(
    private readonly notify?: {
      onEnqueued?: (review: PendingIncomingReview) => void
      onRemoved?: (externalId: string) => void
    },
  ) {}

  async enqueue(review: PendingIncomingReview): Promise<void> {
    // durable 먼저 (PK=externalId — put 멱등), UI 미러는 그 후
    await getDatabase().incomingReviews.put(toRecord(review))
    this.notify?.onEnqueued?.(review)
  }

  async listAll(): Promise<PendingIncomingReview[]> {
    const records = await getDatabase().incomingReviews.orderBy('queuedAt').toArray()
    return records.map(fromRecord)
  }

  async listByMint(mintUrl: string): Promise<PendingIncomingReview[]> {
    // 인덱스 조회가 아니라 정규화 비교 스캔 — 큐 행의 mintUrl은 발신자 지갑이
    // 토큰에 인코딩한 raw 값이라 :443·대소문자·trailing slash 표기가 조회측
    // (설정의 정규화 URL)과 다를 수 있다 (4단계 리뷰 #6). 대기열은 작으므로
    // 전체 스캔 비용은 무시 가능하다.
    const target = normalizeMintKey(mintUrl)
    const records = await getDatabase().incomingReviews.orderBy('queuedAt').toArray()
    return records.filter((r) => normalizeMintKey(r.mintUrl) === target).map(fromRecord)
  }

  async remove(externalId: string): Promise<void> {
    await getDatabase().incomingReviews.delete(externalId)
    this.notify?.onRemoved?.(externalId)
  }
}

// 민트 동일성 비교 키 — 기본 포트(:443/:80)·호스트 대소문자·trailing slash를
// 흡수한다. URL 파싱 불가 문자열은 소문자+슬래시 제거로 폴백.
function normalizeMintKey(mintUrl: string): string {
  try {
    const url = new URL(mintUrl)
    const path = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname
    return `${url.protocol}//${url.host}${path}`.toLowerCase()
  } catch {
    const trimmed = mintUrl.endsWith('/') ? mintUrl.slice(0, -1) : mintUrl
    return trimmed.toLowerCase()
  }
}

// bigint는 IDB 구현별 structured clone 편차가 있어 문자열로 왕복한다
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
