import type { RecoveryStore } from '@/core/ports/driven/recovery-store.port'
import type { SyncAnchor, ProcessedRecord } from '@/core/types'
import { SettingsRepository } from '@/data/repositories/settings.repository'
import { ProcessedRepository } from '@/data/repositories/processed.repository'

export class RecoveryStoreAdapter implements RecoveryStore {
  private settings = new SettingsRepository()
  private processed = new ProcessedRepository()

  async getAnchor(): Promise<SyncAnchor | null> {
    return this.settings.getSyncAnchor()
  }

  async saveAnchor(anchor: SyncAnchor): Promise<void> {
    return this.settings.saveSyncAnchor(anchor)
  }

  async isProcessed(externalId: string): Promise<boolean> {
    return this.processed.isProcessed(externalId)
  }

  async markProcessed(record: ProcessedRecord): Promise<void> {
    return this.processed.markProcessed(record)
  }
}
