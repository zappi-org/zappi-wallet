/**
 * Composition root for SwapUseCase
 */

import { SwapService } from '@/core/services/swap.service'
import type { SwapUseCase } from '@/core/ports/driving/swap.usecase'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import { abandonMintQuote, markQuoteAsSwap, unmarkQuoteAsSwap } from '@/modules/cashu'

export function createSwapService(
  modules: WalletModule[],
  txRepo: TransactionRepository,
  eventBus: EventBus,
): SwapUseCase {
  return new SwapService(modules, txRepo, eventBus, {
    mark: markQuoteAsSwap,
    unmark: unmarkQuoteAsSwap,
    abandon: abandonMintQuote,
  })
}
