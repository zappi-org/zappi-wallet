/**
 * DexieGiftwrapCursorStore — GiftwrapCursorStore implementation.
 *
 * Uses the new giftwrapCursors table (v21). The existing syncAnchor row has a fixed
 * 'current' PK so it can't be extended in place — this uses a new table and preserves
 * the legacy row for anchor display.
 *
 * Migration policy: does NOT seed lastFullSyncAtMs from the legacy timestamp. That value
 * was updated at the end of every reconstructState (even on a partial/empty fetch), so it
 * carries no "received everything up to here" invariant — using it as a since lower bound
 * would permanently exclude unreceived events from the partial sync just before upgrade.
 * Instead, per the design: existing users do one full replay on upgrade, then establish
 * (lastFullSyncAtMs=0). Establishment happens only via a true full EOSE (markFullSync).
 */

import type { GiftwrapCursorStore } from '@/core/ports/driven/giftwrap-cursor-store.port'
import {
  createGiftwrapCursorRecord,
  type GiftwrapCursorRecord,
} from '@/core/domain/giftwrap-cursor'
import { getDatabase } from './schema'

export class DexieGiftwrapCursorStore implements GiftwrapCursorStore {
  /**
   * Creates and returns the record if missing (always non-null). Creation and read happen
   * within a single 'rw' transaction to prevent a read-modify-write race with concurrent
   * mark calls from overwriting a new mark with the initial record.
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
