/**
 * Composition root for AnchorUseCase
 */

import { AnchorStoreAdapter } from '@/adapters/storage/anchor-store.adapter'
import { AnchorService } from '@/core/services/anchor.service'
import type { AnchorUseCase } from '@/core/ports/driving/anchor.usecase'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'

export function createAnchorService(nostrGateway: NostrGateway): AnchorUseCase {
  return new AnchorService(
    nostrGateway,
    new AnchorStoreAdapter(),
  )
}
