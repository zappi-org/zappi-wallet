/**
 * Composition root for PaymentUseCase
 *
 * modules는 bootstrap에서 주입 — composition/에서 modules/ import 금지.
 */

import { PaymentService } from '@/core/services/payment.service'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import type { OperationMap } from '@/core/ports/driven/operation-map.port'

export function createPaymentService(
  modules: WalletModule[],
  txRepo: TransactionRepository,
  eventBus: EventBus,
  operationMap?: OperationMap,
): PaymentUseCase {
  return new PaymentService(
    modules,
    txRepo,
    eventBus,
    operationMap,
  )
}
