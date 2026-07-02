/**
 * Composition root for PaymentUseCase
 *
 * modules는 bootstrap에서 주입 — composition/에서 modules/ import 금지.
 */

import { PaymentService } from '@/core/services/payment.service'
import type { WalletModule } from '@/core/ports/driven/wallet-module.port'
import type { TransactionRepository } from '@/core/ports/driven/transaction.repository.port'
import type { EventBus } from '@/core/events/event-bus'
import type { OperationMap } from '@/core/ports/driven/operation-map.port'
import type { TransferLifecycleService } from '@/core/services/transfer-lifecycle.service'

// 반환은 구체 클래스 — bootstrap이 setRecoveryDelegate(설계 §6.2)를 배선해야
// 한다. UI/레지스트리에는 PaymentUseCase로만 노출된다.
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
