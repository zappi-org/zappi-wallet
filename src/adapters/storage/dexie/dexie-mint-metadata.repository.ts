import type { MintMetadata } from '@/core/types'
import type { MetadataStore } from '@/modules/cashu'
import { getDatabase } from './schema'

/**
 * Standalone Dexie mint metadata repository.
 * Implements MetadataStore interface for MintMetadataService.
 */
export class DexieMintMetadataRepository implements MetadataStore {
  private get table() {
    return getDatabase().mintMetadata
  }

  async get(mintUrl: string): Promise<MintMetadata | null> {
    return (await this.table.get(mintUrl)) ?? null
  }

  async getAll(): Promise<MintMetadata[]> {
    return this.table.toArray()
  }

  async getMany(mintUrls: string[]): Promise<Map<string, MintMetadata>> {
    const records = await this.table.where('url').anyOf(mintUrls).toArray()
    return new Map(records.map((r) => [r.url, r]))
  }

  async save(metadata: MintMetadata): Promise<void> {
    await this.table.put(metadata)
  }

  async saveMany(metadataList: MintMetadata[]): Promise<void> {
    await this.table.bulkPut(metadataList)
  }

  async delete(mintUrl: string): Promise<void> {
    await this.table.delete(mintUrl)
  }

  async clear(): Promise<void> {
    await this.table.clear()
  }

  async needsRefresh(mintUrl: string, maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<boolean> {
    const metadata = await this.get(mintUrl)
    if (!metadata) return true
    return Date.now() - metadata.fetchedAt > maxAgeMs
  }
}
