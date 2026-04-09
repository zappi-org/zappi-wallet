import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { ProcessedRecord } from '@/core/types'
import { getDatabase } from './schema'

export class DexieProcessedRepository implements ProcessedStore {
  private get table() {
    return getDatabase().processedRecords
  }

  async save(record: ProcessedRecord): Promise<void> {
    await this.table.put(record)
  }

  async exists(externalId: string): Promise<boolean> {
    const count = await this.table.where('externalId').equals(externalId).count()
    return count > 0
  }

  async existsByTxId(txId: string): Promise<boolean> {
    const count = await this.table.where('txId').equals(txId).count()
    return count > 0
  }

  async findById(externalId: string): Promise<ProcessedRecord | null> {
    return (await this.table.get(externalId)) ?? null
  }

  async findByTxId(txId: string): Promise<ProcessedRecord | null> {
    return (await this.table.where('txId').equals(txId).first()) ?? null
  }
}
