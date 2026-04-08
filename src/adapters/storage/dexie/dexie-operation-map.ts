import type { OperationMap } from '@/core/ports/driven/operation-map.port'
import { getDatabase } from './schema'

/**
 * pendingSendTokens 테이블 + 인메모리 매핑 + transactions metadata 기반 OperationMap 구현.
 *
 * resolve: 인메모리 매핑 → pendingSendTokens → transactions metadata 순서로 조회.
 * register: receive() 등에서 quoteId → txId 등 경량 매핑 등록 (인메모리).
 *
 * pending 레코드는 항상 소수(한 자릿수)이므로 인덱스 없이 scan.
 * finalize/reclaim 후 레코드가 삭제되면 resolve()는 null 반환 — 정상 동작.
 */
export class DexieOperationMap implements OperationMap {
  private memoryMap = new Map<string, string>()

  async resolve(operationRef: string): Promise<string | null> {
    // 1. 인메모리 매핑 우선 (receive → mintQuoteObserver settle 용)
    const memoryHit = this.memoryMap.get(operationRef)
    if (memoryHit) return memoryHit

    const db = getDatabase()

    // 2. pendingSendTokens 테이블 (send → sendTokenObserver settle 용)
    const records = await db.pendingSendTokens.toArray()
    const match = records.find((r) => r.operationId === operationRef)
    if (match) return match.id

    // 3. transactions metadata 폴백 (페이지 리프레시 후 인메모리 매핑 소실 대비)
    const pendingTxs = await db.transactions.where('status').equals('pending').toArray()
    const txMatch = pendingTxs.find((tx) => tx.metadata?.operationId === operationRef)
    if (txMatch) return txMatch.id

    return null
  }

  register(operationRef: string, txId: string): void {
    this.memoryMap.set(operationRef, txId)
  }
}
