import type { SyncAnchor, ProcessedEvent } from '@/core/types'

export interface RecoveryStore {
  getAnchor(): Promise<SyncAnchor | null>
  saveAnchor(anchor: SyncAnchor): Promise<void>
  isEventProcessed(eventId: string): Promise<boolean>
  markEventProcessed(event: ProcessedEvent): Promise<void>
}
