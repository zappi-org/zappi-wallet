import type { MintMetadata } from '@/core/types'

export interface MintMetadataUseCase {
  getMetadataForMints(urls: string[]): Promise<Map<string, MintMetadata>>
  getMetadata(mintUrl: string): Promise<MintMetadata | null>
  refresh(mintUrl: string): Promise<MintMetadata | null>
  refreshIfMissing(mintUrl: string): Promise<void>
  fetchAndCache(mintUrl: string): Promise<MintMetadata | null>
  supports(mintUrl: string, nut: number): Promise<boolean>
  subscribe(cb: (mintUrl: string, metadata: MintMetadata) => void): () => void
  extractHostname(mintUrl: string): string
}
