import type { RoutingUseCase } from '@/core/ports/driving/routing.usecase'
import type { FeeEstimator } from '@/core/ports/driven/fee-estimator.port'
import { RequestGate } from '@/core/utils/request-gate'
import {
  type PaymentRoute,
  type RouteInput,
  type FeeEstimate,
  selectRoute as domainSelectRoute,
  findCommonMints as domainFindCommonMints,
} from '@/core/domain/routing'

export class RoutingService implements RoutingUseCase {
  /**
   * Fee estimate cache: key (route, source, target, amount[, invoice]), TTL 60s +
   * in-flight sharing. my-wallet/cross-mint estimates are a 4-round-trip that creates
   * and deletes a real quote on the target mint, so this absorbs the duplicate
   * round-trips from SendFlow→ConfirmStep re-entry and same-amount retries.
   * Honest scope: since amount is part of the key, editing the amount keeps a fresh
   * round-trip each time — the guaranteed win is only re-entry with the same combination.
   * Failure cooldown 5s: blocks only the immediate retry storm right after an estimate
   * failure, while still allowing quick user retries.
   */
  private readonly estimateGate = new RequestGate({ cooldownMs: 60_000, failureCooldownMs: 5_000 })

  constructor(private readonly feeEstimator: FeeEstimator) {}

  selectRoute(input: RouteInput): PaymentRoute {
    return domainSelectRoute(input)
  }

  findCommonMints(senderMints: string[], receiverMints: string[]): string[] {
    return domainFindCommonMints(senderMints, receiverMints)
  }

  async estimateRouteFee(
    route: PaymentRoute,
    sourceMint: string,
    amount: number,
    targetMint?: string,
    invoice?: string,
  ): Promise<FeeEstimate> {
    // invoice is the payment-unit identifier — only re-estimates of the same invoice share the cache
    const key = `route:${route}:${sourceMint}:${targetMint ?? ''}:${amount}:${invoice ?? ''}`
    const { value } = await this.estimateGate.run(key, () =>
      this.feeEstimator.estimateRouteFee(route, sourceMint, amount, targetMint, invoice),
    )
    return value
  }

}
