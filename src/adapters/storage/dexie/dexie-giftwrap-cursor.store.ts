/**
 * DexieGiftwrapCursorStore — GiftwrapCursorStore 구현 (설계 §10 B5)
 *
 * 신규 giftwrapCursors 테이블(v21) 사용. 기존 syncAnchor 행은 PK가 'current'
 * 고정이라 in-place 확장이 불가([F7]) — 신규 테이블을 쓰고 레거시 행은 anchor
 * 표시용으로 보존한다.
 *
 * 마이그레이션 정책 (2단계 리뷰 #5): 레거시 timestamp를 lastFullSyncAtMs로
 * seed하지 **않는다**. 그 값은 매 reconstructState 말미에 (부분/빈 fetch여도)
 * 갱신되던 값이라 "여기까지 전부 받았다" 불변식이 없다 — since 하한으로 쓰면
 * 업그레이드 직전 부분 동기화의 미수신 이벤트가 영구 제외된다. 설계 원문대로
 * "기존 사용자 업그레이드 시 1회 전체 replay 후 확립"(lastFullSyncAtMs=0)한다.
 * 확립은 오직 진짜 全EOSE(markFullSync)로만 일어난다.
 */

import type { GiftwrapCursorStore } from '@/core/ports/driven/giftwrap-cursor-store.port'
import {
  createGiftwrapCursorRecord,
  type GiftwrapCursorRecord,
} from '@/core/domain/giftwrap-cursor'
import { getDatabase } from './schema'

export class DexieGiftwrapCursorStore implements GiftwrapCursorStore {
  /**
   * 레코드가 없으면 생성해 반환한다(항상 non-null). 생성·읽기를 단일 'rw' 트랜잭션
   * 안에서 수행 — 동시 mark 계열과의 read-modify-write 경합으로 새 마크가
   * 초기 레코드에 덮이는 것을 방지한다 (리뷰 #8).
   */
  async load(key: string): Promise<GiftwrapCursorRecord | null> {
    const db = getDatabase()
    return db.transaction('rw', db.giftwrapCursors, async () => {
      const existing = await db.giftwrapCursors.get(key)
      if (existing) return existing

      const fresh = createGiftwrapCursorRecord(key, Date.now())
      await db.giftwrapCursors.put(fresh)
      return fresh
    })
  }

  private async upsert(
    key: string,
    mutate: (record: GiftwrapCursorRecord) => void,
  ): Promise<void> {
    const db = getDatabase()
    await db.transaction('rw', db.giftwrapCursors, async () => {
      const record =
        (await db.giftwrapCursors.get(key)) ?? createGiftwrapCursorRecord(key, Date.now())
      mutate(record)
      await db.giftwrapCursors.put(record)
    })
  }

  async markAttempt(key: string, atMs: number): Promise<void> {
    await this.upsert(key, (record) => {
      record.lastAttemptAtMs = atMs
    })
  }

  async markRelayEose(key: string, relayUrl: string, atMs: number): Promise<void> {
    await this.upsert(key, (record) => {
      record.relayEoseAtMs = { ...record.relayEoseAtMs, [relayUrl]: atMs }
    })
  }

  async markFullSync(key: string, atMs: number): Promise<void> {
    await this.upsert(key, (record) => {
      record.lastFullSyncAtMs = atMs
    })
  }

  async markDeepResync(key: string, atMs: number): Promise<void> {
    await this.upsert(key, (record) => {
      record.deepResyncAtMs = atMs
    })
  }
}
