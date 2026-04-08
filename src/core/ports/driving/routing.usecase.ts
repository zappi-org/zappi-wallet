import type { RouteInput, FeeEstimate } from '@/core/domain/routing'
import type { PaymentRoute } from '@/core/domain/routing'
// Re-export PaymentRoute runtime values + ROUTE_LABELS for hooks/UI consumption
export { PaymentRoute, ROUTE_LABELS } from '@/core/domain/routing'
export type { RouteInput, FeeEstimate }

export interface RoutingUseCase {
  selectRoute(input: RouteInput): PaymentRoute
  findCommonMints(senderMints: string[], receiverMints: string[]): string[]
  estimateRouteFee(
    route: PaymentRoute,
    sourceMint: string,
    amount: number,
    targetMint?: string,
    invoice?: string,
  ): Promise<FeeEstimate>
  estimateMyWalletFee(
    sourceMint: string,
    targetMint: string,
    amount: number,
  ): Promise<FeeEstimate>
}
