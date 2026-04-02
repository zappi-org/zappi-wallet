import { getDatabase } from '@/data/database'
import type { MintMetadata } from '@/core/types'
import type { MetadataStore } from '@/modules/cashu/internal/metadata-store'

/**
 * Repository for managing mint metadata (NUT-06) with offline caching
 */
export class MintMetadataRepository implements MetadataStore {
  private get db() {
    return getDatabase()
  }

  /**
   * Get cached metadata for a mint
   */
  async get(mintUrl: string): Promise<MintMetadata | null> {
    const record = await this.db.mintMetadata.get(mintUrl)
    return record ?? null
  }

  /**
   * Get all cached metadata
   */
  async getAll(): Promise<MintMetadata[]> {
    return await this.db.mintMetadata.toArray()
  }

  /**
   * Get metadata for multiple mints
   */
  async getMany(mintUrls: string[]): Promise<Map<string, MintMetadata>> {
    const records = await this.db.mintMetadata.where('url').anyOf(mintUrls).toArray()
    return new Map(records.map((r) => [r.url, r]))
  }

  /**
   * Save or update metadata for a mint
   */
  async save(metadata: MintMetadata): Promise<void> {
    await this.db.mintMetadata.put(metadata)
  }

  /**
   * Save multiple metadata records
   */
  async saveMany(metadataList: MintMetadata[]): Promise<void> {
    await this.db.mintMetadata.bulkPut(metadataList)
  }

  /**
   * Delete metadata for a mint
   */
  async delete(mintUrl: string): Promise<void> {
    await this.db.mintMetadata.delete(mintUrl)
  }

  /**
   * Clear all cached metadata
   */
  async clear(): Promise<void> {
    await this.db.mintMetadata.clear()
  }

  /**
   * Check if metadata needs refresh (older than maxAge)
   */
  async needsRefresh(mintUrl: string, maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<boolean> {
    const metadata = await this.get(mintUrl)
    if (!metadata) return true
    return Date.now() - metadata.fetchedAt > maxAgeMs
  }
}
