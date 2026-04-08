import type { MintMetadataStore } from '@/core/ports/driven/mint-metadata-store.port'
import type { MintMetadata } from '@/core/types'

export class MintMetadataStoreAdapter implements MintMetadataStore {
  constructor(
    private readonly delegate: {
      getMetadataForMints(urls: string[]): Promise<Map<string, MintMetadata>>
      getMetadata(mintUrl: string): Promise<MintMetadata | null>
      refresh(mintUrl: string): Promise<MintMetadata | null>
      refreshIfMissing(mintUrl: string): Promise<void>
      fetchAndCache(mintUrl: string): Promise<MintMetadata | null>
      supports(mintUrl: string, nut: number): Promise<boolean>
      extractHostname(mintUrl: string): string
    },
    private readonly events: {
      subscribe(cb: (mintUrl: string, metadata: MintMetadata) => void): () => void
    },
  ) {}

  getMetadataForMints(urls: string[]): Promise<Map<string, MintMetadata>> {
    return this.delegate.getMetadataForMints(urls)
  }

  getMetadata(mintUrl: string): Promise<MintMetadata | null> {
    return this.delegate.getMetadata(mintUrl)
  }

  refresh(mintUrl: string): Promise<MintMetadata | null> {
    return this.delegate.refresh(mintUrl)
  }

  refreshIfMissing(mintUrl: string): Promise<void> {
    return this.delegate.refreshIfMissing(mintUrl)
  }

  fetchAndCache(mintUrl: string): Promise<MintMetadata | null> {
    return this.delegate.fetchAndCache(mintUrl)
  }

  supports(mintUrl: string, nut: number): Promise<boolean> {
    return this.delegate.supports(mintUrl, nut)
  }

  subscribe(cb: (mintUrl: string, metadata: MintMetadata) => void): () => void {
    return this.events.subscribe(cb)
  }

  extractHostname(mintUrl: string): string {
    return this.delegate.extractHostname(mintUrl)
  }
}
