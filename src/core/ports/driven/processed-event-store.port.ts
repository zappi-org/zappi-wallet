import type { ProcessedEvent } from '@/core/types'

export interface ProcessedEventStore {
  save(event: ProcessedEvent): Promise<void>
  markProcessed(event: ProcessedEvent): Promise<void>
  isProcessed(eventId: string): Promise<boolean>
  findByEventId(eventId: string): Promise<ProcessedEvent | null>
  findByTxId(txId: string): Promise<ProcessedEvent | null>
  exists(eventId: string): Promise<boolean>
  existsByTxId(txId: string): Promise<boolean>
}
