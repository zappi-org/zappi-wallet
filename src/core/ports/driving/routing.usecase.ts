import type { RouteInput, FeeEstimate } from '@/core/domain/routing'
import type { PaymentRoute } from '@/core/domain/routing'
// Re-export PaymentRoute runtime values + ROUTE_LABELS for hooks/UI consumption
export { PaymentRoute, ROUTE_LABELS } from '@/core/domain/routing'
export type { RouteInput, FeeEstimate }

export interface RoutingUseCase {
  selectRoute(input: RouteInput): PaymentRoute
  findCommonMints(senderMints: string[], receiverMints: string[]): string[]
  // my-wallet quoting is handled by estimateRouteFee (LN_CROSS_MINT/...) via
  // internal delegation — after SendConfirmStep's double-quote was removed, no
  // separate surface consumed it, so it was dropped from the driving port. The
  // adapter's estimateMyWalletFee remains as estimateRouteFee's delegation target.
  estimateRouteFee(
    route: PaymentRoute,
    sourceMint: string,
    amount: number,
    targetMint?: string,
    invoice?: string,
  ): Promise<FeeEstimate>
}
