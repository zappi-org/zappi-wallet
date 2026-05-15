/**
 * Composition root for RecoveryUseCase
 */

import { AnchorStoreAdapter } from '@/adapters/storage/anchor-store.adapter'
import { RecoveryStoreAdapter } from '@/adapters/storage/recovery-store.adapter'
import { FailedIncomingStoreAdapter } from '@/adapters/storage/failed-incoming-store.adapter'
import { TokenReceiverAdapter } from './token-receiver.adapter'
import { RecoveryService } from '@/core/services/recovery.service'
import { TokenCodecAdapter } from '@/adapters/codec/token-codec.adapter'
import type { RecoveryUseCase } from '@/core/ports/driving/recovery.usecase'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { ReceiveRequestUseCase } from '@/core/ports/driving/receive-request.usecase'
import type { TrustedMintProvider } from '@/core/ports/driven/trusted-mint-provider.port'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { GiftWrapSyncUseCase } from '@/core/ports/driving/gift-wrap-sync.usecase'

export function createRecoveryService(
  nostrGateway: NostrGateway,
  payment: PaymentUseCase,
  trustedMintProvider: TrustedMintProvider,
  incomingReviewQueue: IncomingReviewQueue,
  receiveRequest?: Pick<ReceiveRequestUseCase, 'settleByPaymentRef'>,
  giftWrapSync?: GiftWrapSyncUseCase,
): RecoveryUseCase {
  return new RecoveryService(
    nostrGateway,
    new AnchorStoreAdapter(),
    new RecoveryStoreAdapter(),
    new FailedIncomingStoreAdapter(),
    new TokenReceiverAdapter(payment),
    trustedMintProvider,
    incomingReviewQueue,
    new TokenCodecAdapter(),
    receiveRequest,
    giftWrapSync,
  )
}
