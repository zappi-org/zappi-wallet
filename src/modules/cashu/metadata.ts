/**
 * Lightweight entry point for mint metadata.
 * Does NOT load coco-cashu-core SDK.
 */
export {
  MintMetadataService,
  type NutMethod,
  nutSupported,
  nutMethods,
  nutConfig,
} from './internal/mint-metadata'
export type { MetadataStore } from './internal/metadata-store'
export { metadataEvents } from './internal/metadata-events'

// MintMetadataService class is exported for composition layer to create instances.
// Singleton creation is in composition/bootstrap.ts (not here — modules/ cannot import adapters/).
