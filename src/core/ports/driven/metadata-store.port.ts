import type { MintMetadata } from '@/core/types'

/**
 * Low-level metadata persistence interface.
 * Used by MintMetadataService (modules/cashu/internal) for IndexedDB caching.
 */
export interface MetadataStore {
  get(mintUrl: string): Promise<MintMetadata | null>
  getMany(mintUrls: string[]): Promise<Map<string, MintMetadata>>
  save(metadata: MintMetadata): Promise<void>
  clear(): Promise<void>
}
