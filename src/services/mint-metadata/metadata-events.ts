import type { MintMetadata } from '@/core/types'

type MetadataListener = (mintUrl: string, metadata: MintMetadata) => void

/**
 * Simple event emitter for mint metadata updates.
 * Bridges the service layer (non-React) with React hooks.
 * When metadata is fetched/refreshed in IndexedDB, hooks subscribe
 * to receive updates and sync their React state.
 */
class MetadataEventEmitter {
  private listeners = new Set<MetadataListener>()

  subscribe(listener: MetadataListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(mintUrl: string, metadata: MintMetadata): void {
    this.listeners.forEach((fn) => fn(mintUrl, metadata))
  }
}

export const metadataEvents = new MetadataEventEmitter()
