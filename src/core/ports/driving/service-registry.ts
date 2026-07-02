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
import type { RecoverySchedulerUseCase } from '@/core/ports/driving/recovery-scheduler.usecase'
import type { IncomingPaymentUseCase } from '@/core/ports/driving/incoming-payment.usecase'
import type { PendingItemsUseCase } from '@/core/ports/driving/pending-items.usecase'
import type { ProcessedStore } from '@/core/ports/driven/processed-store.port'
import type { IncomingReviewQueue } from '@/core/ports/driven/incoming-review-queue.port'
import type { NostrGateway } from '@/core/ports/driven/nostr-gateway.port'
import type { MintMetadataUseCase } from '@/core/ports/driving/mint-metadata.usecase'
import type { MintHealthUseCase } from '@/core/ports/driving/mint-health.usecase'
import type { MintInfoUseCase } from '@/core/ports/driving/mint-info.usecase'
import type { CryptoUseCase } from '@/core/ports/driving/crypto.usecase'
import type { ReceiveRequestUseCase } from '@/core/ports/driving/receive-request.usecase'
import type { ReclaimUseCase } from '@/core/ports/driving/reclaim.usecase'
import type { TransactionMgmtUseCase } from '@/core/ports/driving/transaction-mgmt.usecase'
import type { InputParserUseCase } from '@/core/ports/driving/input-parser.usecase'
import type { PaymentRequestUseCase } from '@/core/ports/driving/payment-request.usecase'
import type { RoutingUseCase } from '@/core/ports/driving/routing.usecase'
import type { UsernameUseCase } from '@/core/ports/driving/username.usecase'
import type { TrustRegistry } from '@/core/ports/driving/trust-registry.usecase'
import type { SupportUseCase } from '@/core/ports/driving/support.usecase'
import type { NostrDirectPaymentUseCase } from '@/core/ports/driving/nostr-direct-payment.usecase'
import type { ExternalWalletRecoveryUseCase } from '@/core/ports/driving/external-wallet-recovery.usecase'
import type { TransferLifecycleService } from '@/core/services/transfer-lifecycle.service'

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
  /** recoverAll 행동 분해 — reconcile/targeted/drain/full (설계 §6.2) */
  readonly recoveryScheduler: RecoverySchedulerUseCase
  readonly incomingPayment: IncomingPaymentUseCase
  readonly processedStore: ProcessedStore
  /** review 승인/거절/drain의 durable 제거 경로 — Zustand 미러는 어댑터가 동기화 (설계 §6.2) */
  readonly incomingReviewQueue: IncomingReviewQueue
  readonly nostrGateway: NostrGateway
  readonly pendingItems: PendingItemsUseCase
  readonly withdraw: WithdrawUseCase
  readonly lnurlAuth: LnurlAuthUseCase
  readonly mintMetadata: MintMetadataUseCase
  readonly mintHealth: MintHealthUseCase
  /** 상세 화면용 raw NUT-06 info — 24h 캐시 우선, fresh=probe (설계 §5) */
  readonly mintInfo: MintInfoUseCase
  readonly crypto: CryptoUseCase
  readonly receiveRequest: ReceiveRequestUseCase
  readonly reclaim: ReclaimUseCase
  readonly transactionMgmt: TransactionMgmtUseCase
  readonly inputParser: InputParserUseCase
  readonly paymentRequest: PaymentRequestUseCase
  readonly routing: RoutingUseCase
  readonly username: UsernameUseCase
  readonly trustRegistry: TrustRegistry
  readonly support: SupportUseCase
  readonly nostrDirectPayment: NostrDirectPaymentUseCase
  readonly externalWalletRecovery: ExternalWalletRecoveryUseCase
  readonly transferLifecycle: TransferLifecycleService
}
