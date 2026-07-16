import { getDatabase } from './schema'
import type { LightningReceiptCursor } from '@/core/domain/lightning-receipt-cursor'

export type { LightningReceiptCursor }

export class DexieLightningReceiptCursorStore {
  async get(key: string): Promise<LightningReceiptCursor | null> {
    const db = getDatabase()
    return db.transaction('r', db.lightningReceiptCursors, async () => {
      return (await db.lightningReceiptCursors.get(key)) ?? null
    })
  }

  async put(record: LightningReceiptCursor): Promise<void> {
    const db = getDatabase()
    await db.transaction('rw', db.lightningReceiptCursors, async () => {
      await db.lightningReceiptCursors.put(record)
    })
  }

  async upsert(key: string, lastSyncAtMs: number): Promise<void> {
    const db = getDatabase()
    await db.transaction('rw', db.lightningReceiptCursors, async () => {
      const record: LightningReceiptCursor = { key, lastSyncAtMs }
      await db.lightningReceiptCursors.put(record)
    })
  }
}
