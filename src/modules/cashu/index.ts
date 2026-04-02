export { classifyCashuError } from './internal/classify-error'
export {
  MintMetadataService,
  type MetadataStore,
  type NutMethod,
  nutSupported,
  nutMethods,
  nutConfig,
} from './internal/mint-metadata'
export { metadataEvents } from './internal/metadata-events'

// Composition: assemble MintMetadataService with Dexie store
import { MintMetadataService } from './internal/mint-metadata'
import { MintMetadataRepository } from '@/data/repositories/mint-metadata.repository'

export const mintMetadataService = new MintMetadataService(new MintMetadataRepository())
