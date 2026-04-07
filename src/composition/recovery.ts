/**
 * Composition root for RecoveryUseCase
 */

import { AnchorStoreAdapter } from '@/adapters/storage/anchor-store.adapter'
import { RecoveryStoreAdapter } from '@/adapters/storage/recovery-store.adapter'
import { FailedSwapStoreAdapter } from '@/adapters/storage/failed-swap-store.adapter'
import { TokenReceiverAdapter } from '@/adapters/payment/token-receiver.adapter'
import { RecoveryService } from '@/core/services/recovery.service'
import type { RecoveryUseCase } from '@/core/ports/driving/recovery.usecase'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'

export function createRecoveryService(nostrGateway: NostrGateway, payment: PaymentUseCase): RecoveryUseCase {
  return new RecoveryService(
    nostrGateway,
    new AnchorStoreAdapter(),
    new RecoveryStoreAdapter(),
    new FailedSwapStoreAdapter(),
    new TokenReceiverAdapter(payment),
  )
}
