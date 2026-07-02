import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DexieGiftwrapCursorStore } from '@/adapters/storage/dexie/dexie-giftwrap-cursor.store'
import { getDatabase, resetDatabase } from '@/adapters/storage/dexie/schema'

const KEY = 'giftwrap:abcd1234'

describe('DexieGiftwrapCursorStore', () => {
  let store: DexieGiftwrapCursorStore

  beforeEach(async () => {
    await resetDatabase()
    store = new DexieGiftwrapCursorStore()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  it('load creates a fresh record on first access (lastFullSyncAtMs=0 → 최초 1회 전체 replay)', async () => {
    const record = await store.load(KEY)

    expect(record).not.toBeNull()
    expect(record!.v).toBe(2)
    expect(record!.lastFullSyncAtMs).toBe(0)
    expect(record!.deepResyncAtMs).toBeGreaterThan(0)
  })

  /**
   * 마이그레이션 정책 (2단계 리뷰 #5): 레거시 syncAnchor.timestamp는 부분/빈
   * fetch에도 갱신되던 값이라 since 하한 자격이 없다 — seed하지 않는다.
   * 업그레이드 사용자는 설계 원문대로 1회 전체 replay 후 진짜 全EOSE로 확립한다.
   */
  it('does NOT seed lastFullSyncAtMs from a legacy anchor — upgrade gets one full replay', async () => {
    await getDatabase().syncAnchor.put({ id: 'current', timestamp: 1_750_000_000, updatedAt: Date.now() })

    const record = await store.load(KEY)

    expect(record!.lastFullSyncAtMs).toBe(0)
    // 레거시 행은 anchor 표시용으로 보존
    expect(await getDatabase().syncAnchor.get('current')).toMatchObject({ timestamp: 1_750_000_000 })
  })

  it('load is stable — repeated loads return the same persisted record', async () => {
    const first = await store.load(KEY)
    await store.markFullSync(KEY, 777)
    const second = await store.load(KEY)

    expect(second!.createdAtMs).toBe(first!.createdAtMs)
    expect(second!.lastFullSyncAtMs).toBe(777)
  })

  it('markAttempt upserts a record and only touches lastAttemptAtMs', async () => {
    await store.markAttempt(KEY, 111)

    const record = await store.load(KEY)
    expect(record!.lastAttemptAtMs).toBe(111)
    expect(record!.lastFullSyncAtMs).toBe(0)

    await store.markFullSync(KEY, 222)
    await store.markAttempt(KEY, 333)
    const after = await store.load(KEY)
    expect(after!.lastAttemptAtMs).toBe(333)
    expect(after!.lastFullSyncAtMs).toBe(222) // attempt는 since 원천을 건드리지 않는다 [N1]
  })

  it('markRelayEose accumulates per-relay timestamps', async () => {
    await store.markRelayEose(KEY, 'wss://a', 100)
    await store.markRelayEose(KEY, 'wss://b', 200)
    await store.markRelayEose(KEY, 'wss://a', 300)

    const record = await store.load(KEY)
    expect(record!.relayEoseAtMs).toEqual({ 'wss://a': 300, 'wss://b': 200 })
  })

  it('markFullSync / markDeepResync advance their own fields independently', async () => {
    await store.markFullSync(KEY, 1_000)
    await store.markDeepResync(KEY, 2_000)

    const record = await store.load(KEY)
    expect(record!.lastFullSyncAtMs).toBe(1_000)
    expect(record!.deepResyncAtMs).toBe(2_000)
  })

  it('load does not clobber marks committed before it (single-tx ensure — 리뷰 #8)', async () => {
    await store.markRelayEose(KEY, 'wss://a', 999)
    await store.markFullSync(KEY, 555)

    const record = await store.load(KEY)
    expect(record!.relayEoseAtMs['wss://a']).toBe(999)
    expect(record!.lastFullSyncAtMs).toBe(555)
  })

  it('keys are isolated per pubkey scope', async () => {
    await store.markFullSync('giftwrap:aaaa0000', 1)
    await store.markFullSync('giftwrap:bbbb0000', 2)

    expect((await store.load('giftwrap:aaaa0000'))!.lastFullSyncAtMs).toBe(1)
    expect((await store.load('giftwrap:bbbb0000'))!.lastFullSyncAtMs).toBe(2)
  })
})
