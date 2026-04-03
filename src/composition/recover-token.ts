/**
 * Composition root for RecoverTokenUseCase
 */

import { RecoveryStoreAdapter } from '@/adapters/storage/recovery-store.adapter'
import { FailedSwapStoreAdapter } from '@/adapters/storage/failed-swap-store.adapter'
import { TokenReceiverAdapter } from '@/adapters/payment/token-receiver.adapter'
import { RecoverTokenService } from '@/core/services/recover-token.service'
import type { RecoverTokenUseCase } from '@/core/ports/driving/recover-token.usecase'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'

export function createRecoverTokenService(
  nostrGateway: Pick<NostrGateway, 'fetchGiftWraps'>,
): RecoverTokenUseCase {
  return new RecoverTokenService(
    nostrGateway,
    new RecoveryStoreAdapter(),
    new FailedSwapStoreAdapter(),
    new TokenReceiverAdapter(),
  )
}
