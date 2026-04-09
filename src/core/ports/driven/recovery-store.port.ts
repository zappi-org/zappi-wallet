import type { SyncAnchor, ProcessedRecord } from '@/core/types'

export interface RecoveryStore {
  getAnchor(): Promise<SyncAnchor | null>
  saveAnchor(anchor: SyncAnchor): Promise<void>
  isProcessed(externalId: string): Promise<boolean>
  markProcessed(record: ProcessedRecord): Promise<void>
}
