import type { OperationMap } from '@/core/ports/driven/operation-map.port'
import { getDatabase } from '@/data/database/schema'

/**
 * pendingSendTokens 테이블 기반 OperationMap 구현.
 *
 * pending 레코드는 항상 소수(한 자릿수)이므로 인덱스 없이 scan.
 * finalize/reclaim 후 레코드가 삭제되면 resolve()는 null 반환 — 정상 동작.
 */
export class DexieOperationMap implements OperationMap {
  async resolve(operationRef: string): Promise<string | null> {
    const db = getDatabase()
    const records = await db.pendingSendTokens.toArray()
    const match = records.find((r) => r.operationId === operationRef)
    return match?.id ?? null
  }
}
