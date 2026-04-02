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

// Composition
import { MintMetadataService } from './internal/mint-metadata'
import { MintMetadataRepository } from '@/data/repositories/mint-metadata.repository'

export const mintMetadataService = new MintMetadataService(new MintMetadataRepository())
