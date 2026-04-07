/**
 * ServiceRegistry — driving port 인터페이스 집합
 *
 * hooks/service-context.tsx를 통해 UI에 제공.
 * driven port 없음. optional method 없음.
 * hooks는 이 인터페이스만으로 모든 기능에 접근.
 */

import type { EventBus } from '@/core/events/event-bus'
import type { PaymentUseCase } from '@/core/ports/driving/payment.usecase'
import type { BalanceUseCase } from '@/core/ports/driving/balance.usecase'
import type { SwapUseCase } from '@/core/ports/driving/swap.usecase'
import type { ContactUseCase } from '@/core/ports/driving/contact.usecase'
import type { InputRouterUseCase } from '@/core/ports/driving/input-router.usecase'
import type { AddressResolverUseCase } from '@/core/ports/driving/address-resolver.usecase'
import type { WithdrawUseCase } from '@/core/ports/driving/withdraw.usecase'
import type { LnurlAuthUseCase } from '@/core/ports/driving/lnurl-auth.usecase'
import type { ProfileUseCase } from '@/core/ports/driving/profile.usecase'
import type { RecoveryUseCase } from '@/core/ports/driving/recovery.usecase'
import type { TokenProcessorUseCase } from '@/core/ports/driving/token-processor.usecase'
import type { PendingItemsUseCase } from '@/core/ports/driving/pending-items.usecase'

export interface ServiceRegistry {
  readonly eventBus: EventBus
  readonly payment: PaymentUseCase
  readonly balance: BalanceUseCase
  readonly swap: SwapUseCase
  readonly contact: ContactUseCase
  readonly inputRouter: InputRouterUseCase
  readonly addressResolver: AddressResolverUseCase
  readonly profile: ProfileUseCase
  readonly recovery: RecoveryUseCase
  readonly tokenProcessor: TokenProcessorUseCase
  readonly pendingItems: PendingItemsUseCase
  readonly withdraw: WithdrawUseCase
  readonly lnurlAuth: LnurlAuthUseCase
}
