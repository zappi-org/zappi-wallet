/**
 * Composition root for PaymentUseCase
 *
 * modules are injected from bootstrap — composition/ must not import modules/.
 */

import { PaymentService } from '@/core/services/payment.service'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import type { OperationMap } from '@/core/ports/driven/operation-map.port'
import type { TransferLifecycleService } from '@/core/services/transfer-lifecycle.service'

// Returns the concrete class so bootstrap can wire setRecoveryDelegate.
// To the UI/registry it's exposed only as PaymentUseCase.
export function createPaymentService(
  modules: WalletModule[],
  txRepo: TransactionRepository,
  eventBus: EventBus,
  operationMap?: OperationMap,
  transferLifecycle?: TransferLifecycleService,
): PaymentService {
  return new PaymentService(
    modules,
    txRepo,
    eventBus,
    operationMap,
    transferLifecycle,
  )
}
