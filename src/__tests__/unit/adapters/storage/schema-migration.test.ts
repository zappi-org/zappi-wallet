/**
 * v22→v23 스키마 마이그레이션 핀 (R2-C: legacy proofs 테이블 삭제)
 *
 * 이 코드베이스는 최신 버전 단일 선언 + Dexie 스키마 diff 업그레이드에
 * 의존한다 (failedSwaps/processedEvents 툼스톤과 동일 패턴). 여기서 핀하는
 * 계약: 기존 사용자(v22 설치본)가 v23을 열 때
 *   ① 생존 테이블의 데이터는 무손실로 통과하고
 *   ② proofs object store는 삭제된다 (`proofs: null`).
 * proofs 는 coco 마이그레이션 후 잔존 legacy(감사 :56) — 읽기/쓰기 경로가
 * 없어 데이터 자체가 삭제 대상이다.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Dexie from 'dexie'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'
import { DATABASE } from '@/core/constants'

/** v22 설치본 시뮬레이션 — proofs 포함 구 스키마로 생성 후 데이터 시드 */
async function seedV22Database(): Promise<void> {
  const old = new Dexie(DATABASE.NAME)
  old.version(22).stores({
    transactions: 'id, direction, type, status, createdAt, mintUrl, source, operationId',
    contacts: 'id, name, address, addressType, createdAt',
    proofs: 'id, mintUrl, secret',
  })
  await old.open()
  await old.table('transactions').put({ id: 'tx-1', amount: 21 })
  await old.table('contacts').put({ id: 'c-1', name: 'alice' })
  await old.table('proofs').put({ id: 'p-1', mintUrl: 'https://m', secret: 's', amount: 8 })
  old.close()
}

describe('ZappiDatabase v22→v23 마이그레이션 (proofs 삭제)', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  it('생존 테이블 데이터는 무손실 통과, proofs store는 삭제된다', async () => {
    await seedV22Database()

    const db = getDatabase()
    await db.open()

    // ① 생존 테이블 무손실
    expect(await db.transactions.get('tx-1')).toMatchObject({ id: 'tx-1', amount: 21 })
    expect(await db.contacts.get('c-1')).toMatchObject({ id: 'c-1', name: 'alice' })

    // ② proofs object store 자체가 소멸 (스키마·실 IDB 양쪽)
    expect(db.tables.map((t) => t.name)).not.toContain('proofs')
    expect(Array.from(db.backendDB().objectStoreNames)).not.toContain('proofs')
  })
})
