/**
 * ServiceRegistry — Phase 5 와이어링의 핵심 타입
 *
 * bootstrap.ts가 조립한 UseCase 포트 인터페이스 집합.
 * hooks/service-context.tsx를 통해 UI에 제공됨.
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

export interface ServiceRegistry {
  readonly eventBus: EventBus
  readonly payment: PaymentUseCase
  readonly balance: BalanceUseCase
  readonly swap: SwapUseCase
  readonly contact: ContactUseCase
  readonly inputRouter: InputRouterUseCase
  readonly addressResolver: AddressResolverUseCase
  readonly withdraw?: WithdrawUseCase
  readonly lnurlAuth?: LnurlAuthUseCase
}
