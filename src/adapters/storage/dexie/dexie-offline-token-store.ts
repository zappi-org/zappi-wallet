/**
 * DexieOfflineTokenStore — OfflineTokenStore driven adapter
 *
 * pendingReceivedTokens 테이블 접근을 OfflineTokenStore port로 제공.
 */

import { getDatabase } from './schema'
import type { OfflineTokenStore } from '@/core/ports/driven/offline-token-store.port'

export class DexieOfflineTokenStore implements OfflineTokenStore {
  async getAll() {
    const db = getDatabase()
    return db.pendingReceivedTokens.toArray()
  }

  async put(record: { id: string; token: string; mintUrl: string; amount: number; createdAt: number; metadata?: Record<string, unknown> }) {
    const db = getDatabase()
    await db.pendingReceivedTokens.put(record as Parameters<typeof db.pendingReceivedTokens.put>[0])
  }

  async bulkDelete(ids: string[]) {
    const db = getDatabase()
    await db.pendingReceivedTokens.bulkDelete(ids)
  }
}
