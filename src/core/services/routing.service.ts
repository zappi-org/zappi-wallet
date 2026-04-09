import type { RoutingUseCase } from '@/core/ports/driving/routing.usecase'
import type { FeeEstimator } from '@/core/ports/driven/fee-estimator.port'
import {
  type PaymentRoute,
  type RouteInput,
  type FeeEstimate,
  selectRoute as domainSelectRoute,
  findCommonMints as domainFindCommonMints,
} from '@/core/domain/routing'

export class RoutingService implements RoutingUseCase {
  constructor(private readonly feeEstimator: FeeEstimator) {}

  selectRoute(input: RouteInput): PaymentRoute {
    return domainSelectRoute(input)
  }

  findCommonMints(senderMints: string[], receiverMints: string[]): string[] {
    return domainFindCommonMints(senderMints, receiverMints)
  }

  estimateRouteFee(
    route: PaymentRoute,
    sourceMint: string,
    amount: number,
    targetMint?: string,
    invoice?: string,
  ): Promise<FeeEstimate> {
    return this.feeEstimator.estimateRouteFee(route, sourceMint, amount, targetMint, invoice)
  }

  estimateMyWalletFee(
    sourceMint: string,
    targetMint: string,
    amount: number,
  ): Promise<FeeEstimate> {
    return this.feeEstimator.estimateMyWalletFee(sourceMint, targetMint, amount)
  }
}
