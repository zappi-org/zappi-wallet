/**
 * wipeAccountData 통합 — 실제 Dexie(fake-indexeddb) 위에서 전 테이블 소멸 검증
 * (감사 Phase 1: "로그아웃 후 전 테이블 소멸" 계약을 실코드로 증명)
 *
 * 모킹 없음: getDatabase(실제 스키마 21개 테이블), deleteCocoData(실제 —
 * fake-indexeddb 의 zappi-coco-wallet 삭제), localStorage 어댑터 실물.
 * 죽은 clearAllData 가 proofs·contacts 등 5개 테이블을 빠뜨렸던 나열-드리프트가
 * 동적 열거(db.tables)로는 원천 불가능함을 여기서 핀한다.
 */
import { describe, it, expect, vi } from 'vitest'
import Dexie from 'dexie'
import { getDatabase } from '@/adapters/storage/dexie/schema'
import { DATABASE } from '@/core/constants'
import { wipeAccountData } from '@/composition/logout'

const COCO_DB_NAME = 'zappi-coco-wallet'

/** coco DB 를 실제로 만들어 둔다 — 없으면 "삭제됐다" 단언이 공허해진다 (블라인드 리뷰 M-3) */
function seedCocoDb(): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(COCO_DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('proofs')
    }
    req.onsuccess = () => {
      req.result.close()
      resolve()
    }
    req.onerror = () => reject(req.error)
  })
}

describe('wipeAccountData (통합, fake-indexeddb)', () => {
  it('임의 테이블에 데이터가 있어도 DB 전체가 삭제된다', async () => {
    const db = getDatabase()
    // 서로 다른 성격의 테이블 3곳에 심는다 — 조각별 삭제가 놓치던 부류 포함
    await db.transactions.put({ id: 'tx-1', amount: 21 } as never)
    await db.contacts.put({ id: 'c-1', name: 'alice' } as never)
    await db.proofs.put({ id: 'p-1', mintUrl: 'https://m', amount: 8 } as never)
    expect(await db.transactions.count()).toBe(1)

    await seedCocoDb()
    expect(await Dexie.exists(COCO_DB_NAME)).toBe(true)

    localStorage.setItem('zappi-anchor', '{"eventId":"old"}')
    localStorage.setItem('zappi-balance-cache', '{"total":999}')

    await wipeAccountData({
      security: { deleteWallet: vi.fn().mockResolvedValue(undefined) },
      registry: null,
      removePasskey: vi.fn(),
    })

    // clear(㉠) + delete(㉡) 모두 성공 — DB 자체가 존재하지 않아야 한다
    expect(await Dexie.exists(DATABASE.NAME)).toBe(false)
    expect(await Dexie.exists(COCO_DB_NAME)).toBe(false)
    expect(localStorage.getItem('zappi-anchor')).toBeNull()
    expect(localStorage.getItem('zappi-balance-cache')).toBeNull()
  })
})
