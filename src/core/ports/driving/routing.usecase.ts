import type { RouteInput, FeeEstimate } from '@/core/domain/routing'
import type { PaymentRoute } from '@/core/domain/routing'
// Re-export PaymentRoute runtime values + ROUTE_LABELS for hooks/UI consumption
export { PaymentRoute, ROUTE_LABELS } from '@/core/domain/routing'
export type { RouteInput, FeeEstimate }

export interface RoutingUseCase {
  selectRoute(input: RouteInput): PaymentRoute
  findCommonMints(senderMints: string[], receiverMints: string[]): string[]
  // my-wallet quoting is handled by estimateRouteFee (LN_CROSS_MINT/...) via
  // internal delegation — the confirm screen's separate double-quote surface was
  // removed, so no consumer remained and it was dropped from the driving port. The
  // adapter's estimateMyWalletFee remains as estimateRouteFee's delegation target.
  estimateRouteFee(
    route: PaymentRoute,
    sourceMint: string,
    amount: number,
    targetMint?: string,
    invoice?: string,
    /** fresh bypasses the estimate gate's failure cooldown (explicit user retry). */
    options?: { fresh?: boolean },
  ): Promise<FeeEstimate>
}
