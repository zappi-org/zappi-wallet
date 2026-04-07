/**
 * Composition root for TokenProcessorUseCase
 */

import { TokenProcessorService } from '@/core/services/token-processor.service'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { ProcessedEventStore } from '@/core/ports/driven/processed-event-store.port'
import type { FailedSwapStore } from '@/core/ports/driven/failed-swap-store.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { TokenProcessorUseCase } from '@/core/ports/driving/token-processor.usecase'
import { getDecodedToken } from '@cashu/cashu-ts'

export function createTokenProcessorService(
  payment: PaymentUseCase,
  nostrGateway: NostrGateway,
  processedEventStore: ProcessedEventStore,
  failedSwapStore: FailedSwapStore,
  txRepo: TransactionRepository,
): TokenProcessorUseCase {
  return new TokenProcessorService(
    payment,
    nostrGateway,
    processedEventStore,
    failedSwapStore,
    txRepo,
    {
      decode: (token: string) => {
        const decoded = getDecodedToken(token)
        return {
          mint: decoded.mint,
          proofs: decoded.proofs.map((p) => ({ amount: p.amount })),
        }
      },
    },
  )
}
