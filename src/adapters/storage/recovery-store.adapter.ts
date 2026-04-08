import type { RecoveryStore } from '@/core/ports/driven/recovery-store.port'
import type { SyncAnchor, ProcessedRecord } from '@/core/types'
import { getDatabase } from './dexie/schema'

const CURRENT_ID = 'current'

export class RecoveryStoreAdapter implements RecoveryStore {
  async getAnchor(): Promise<SyncAnchor | null> {
    const record = await getDatabase().syncAnchor.get(CURRENT_ID)
    if (!record) return null
    const { id: _, ...anchor } = record
    return anchor
  }

  async saveAnchor(anchor: SyncAnchor): Promise<void> {
    await getDatabase().syncAnchor.put({ ...anchor, id: CURRENT_ID })
  }

  async isProcessed(externalId: string): Promise<boolean> {
    const count = await getDatabase().processedRecords.where('externalId').equals(externalId).count()
    return count > 0
  }

  async markProcessed(record: ProcessedRecord): Promise<void> {
    await getDatabase().processedRecords.put(record)
  }
}
