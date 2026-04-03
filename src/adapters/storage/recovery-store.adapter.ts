import type { RecoveryStore } from '@/core/ports/driven/recovery-store.port'
import type { SyncAnchor, ProcessedEvent } from '@/core/types'
import { SettingsRepository } from '@/data/repositories/settings.repository'
import { ProcessedEventRepository } from '@/data/repositories/processed-event.repository'

export class RecoveryStoreAdapter implements RecoveryStore {
  private settings = new SettingsRepository()
  private events = new ProcessedEventRepository()

  async getAnchor(): Promise<SyncAnchor | null> {
    return this.settings.getSyncAnchor()
  }

  async saveAnchor(anchor: SyncAnchor): Promise<void> {
    return this.settings.saveSyncAnchor(anchor)
  }

  async isEventProcessed(eventId: string): Promise<boolean> {
    return this.events.isProcessed(eventId)
  }

  async markEventProcessed(event: ProcessedEvent): Promise<void> {
    return this.events.markProcessed(event)
  }
}
