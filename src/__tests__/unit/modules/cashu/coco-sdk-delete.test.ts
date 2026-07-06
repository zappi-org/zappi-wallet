/**
 * deleteCocoData — 자금 DB 삭제의 무음 성공 가장 금지 (감사 Phase 1, 리뷰 BLOCKING-2)
 *
 * 구버전은 onerror/onblocked 에서도 resolve 했다 — 다른 탭이 DB 를 잡고 있으면
 * 자금 DB(proofs)가 통째로 살아남는데 로그아웃은 성공으로 보였다.
 * 핀 대상:
 * - 성공 시 DB 가 실제로 사라진 뒤에만 resolve
 * - blocked 는 대기 상태 — 잡고 있던 커넥션이 versionchange 로 닫히면 이후 성공
 * - 끝내 안 닫히면 타임아웃으로 reject (호출자가 실패를 알 수 있어야 한다)
 */
import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import { deleteCocoData } from '@/modules/cashu'

const COCO_DB_NAME = 'zappi-coco-wallet'

function openRawDb(
  name: string,
  opts?: { closeOnVersionChange?: boolean },
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore('store')
    }
    req.onsuccess = () => {
      const db = req.result
      if (opts?.closeOnVersionChange) {
        db.onversionchange = () => db.close()
      }
      resolve(db)
    }
    req.onerror = () => reject(req.error)
  })
}

describe('deleteCocoData', () => {
  it('열린 커넥션이 없으면 DB 를 삭제하고 resolve', async () => {
    const db = await openRawDb(COCO_DB_NAME)
    db.close()
    expect(await Dexie.exists(COCO_DB_NAME)).toBe(true)

    await deleteCocoData()

    expect(await Dexie.exists(COCO_DB_NAME)).toBe(false)
  })

  it('blocked 는 대기 — versionchange 로 커넥션이 닫히면 이후 성공한다', async () => {
    // Dexie 기반 coco-indexeddb 의 실제 동작 모사: 타 탭은 versionchange 에 자동 close
    await openRawDb(COCO_DB_NAME, { closeOnVersionChange: true })

    await deleteCocoData()

    expect(await Dexie.exists(COCO_DB_NAME)).toBe(false)
  })

  it('커넥션이 끝내 닫히지 않으면 타임아웃으로 reject (무음 성공 가장 금지)', async () => {
    const holder = await openRawDb(COCO_DB_NAME) // versionchange 무시 — 블록 지속

    try {
      await expect(deleteCocoData({ timeoutMs: 150 })).rejects.toThrow(/timed out/)
    } finally {
      holder.close()
      // 잔여 삭제 요청이 완료되도록 정리 (다음 테스트 파일 오염 방지)
      await deleteCocoData().catch(() => undefined)
    }
  })
})
