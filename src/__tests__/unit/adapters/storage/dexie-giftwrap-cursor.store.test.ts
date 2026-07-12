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

  it('load creates a fresh record on first access (lastFullSyncAtMs=0 → one initial full replay)', async () => {
    const record = await store.load(KEY)

    expect(record).not.toBeNull()
    expect(record!.v).toBe(2)
    expect(record!.lastFullSyncAtMs).toBe(0)
    expect(record!.deepResyncAtMs).toBeGreaterThan(0)
  })

  /**
   * Migration policy: the legacy syncAnchor.timestamp was updated even on
   * partial/empty fetches, so it doesn't qualify as a `since` lower bound — don't seed it.
   * Upgrading users get one full replay, then establish a true all-EOSE anchor.
   */
  it('does NOT seed lastFullSyncAtMs from a legacy anchor — upgrade gets one full replay', async () => {
    await getDatabase().syncAnchor.put({ id: 'current', timestamp: 1_750_000_000, updatedAt: Date.now() })

    const record = await store.load(KEY)

    expect(record!.lastFullSyncAtMs).toBe(0)
    // legacy row is preserved for anchor display
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
    expect(after!.lastFullSyncAtMs).toBe(222) // attempt does not touch the since source
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

  it('load does not clobber marks committed before it (single-tx ensure — review #8)', async () => {
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
