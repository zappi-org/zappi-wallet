import type { PendingIncomingReview } from '@/core/types'

/**
 * 미신뢰 민트 수신 review 대기열 (설계 §6.2).
 *
 * 영속 계약: enqueue는 durable 저장이 완료된 뒤 resolve한다 — 호출자
 * (watcher/recovery)는 enqueue 성공 **후에** processed 마킹을 해야 크래시
 * 사이에 토큰이 유실되지 않는다. externalId가 PK라 중복 enqueue는 멱등.
 */
export interface IncomingReviewQueue {
  enqueue(review: PendingIncomingReview): Promise<void>
  /** 부팅 hydrate용 전체 목록 (queuedAt 오름차순) */
  listAll(): Promise<PendingIncomingReview[]>
  /** drainReviewQueue용 — trailing slash 유무 변형 포함 조회 */
  listByMint(mintUrl: string): Promise<PendingIncomingReview[]>
  /** 사용자 승인/거절 또는 drain 성공 시 제거 (없으면 no-op) */
  remove(externalId: string): Promise<void>
}
