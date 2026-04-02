import type { MintMetadata } from '@/core/types'

/**
 * Storage interface for mint metadata.
 * Implemented by data layer (e.g. Dexie repository).
 */
export interface MetadataStore {
  get(mintUrl: string): Promise<MintMetadata | null>
  getMany(mintUrls: string[]): Promise<Map<string, MintMetadata>>
  save(metadata: MintMetadata): Promise<void>
  clear(): Promise<void>
}
