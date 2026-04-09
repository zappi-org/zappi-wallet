import type { MintMetadataUseCase } from '@/core/ports/driving/mint-metadata.usecase'
import type { MintMetadataStore } from '@/core/ports/driven/mint-metadata-store.port'
import type { MintMetadata } from '@/core/types'

export class MintMetadataFacadeService implements MintMetadataUseCase {
  constructor(private readonly store: MintMetadataStore) {}

  getMetadataForMints(urls: string[]): Promise<Map<string, MintMetadata>> {
    return this.store.getMetadataForMints(urls)
  }

  getMetadata(mintUrl: string): Promise<MintMetadata | null> {
    return this.store.getMetadata(mintUrl)
  }

  refresh(mintUrl: string): Promise<MintMetadata | null> {
    return this.store.refresh(mintUrl)
  }

  refreshIfMissing(mintUrl: string): Promise<void> {
    return this.store.refreshIfMissing(mintUrl)
  }

  fetchAndCache(mintUrl: string): Promise<MintMetadata | null> {
    return this.store.fetchAndCache(mintUrl)
  }

  supports(mintUrl: string, nut: number): Promise<boolean> {
    return this.store.supports(mintUrl, nut)
  }

  subscribe(cb: (mintUrl: string, metadata: MintMetadata) => void): () => void {
    return this.store.subscribe(cb)
  }

  extractHostname(mintUrl: string): string {
    return this.store.extractHostname(mintUrl)
  }
}
