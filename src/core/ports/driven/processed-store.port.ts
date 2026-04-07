import type { ProcessedRecord } from '@/core/types'

export interface ProcessedStore {
  save(record: ProcessedRecord): Promise<void>
  exists(externalId: string): Promise<boolean>
  existsByTxId(txId: string): Promise<boolean>
  findById(externalId: string): Promise<ProcessedRecord | null>
  findByTxId(txId: string): Promise<ProcessedRecord | null>
}
