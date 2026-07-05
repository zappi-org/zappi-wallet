import type { RouteInput, FeeEstimate } from '@/core/domain/routing'
import type { PaymentRoute } from '@/core/domain/routing'
// Re-export PaymentRoute runtime values + ROUTE_LABELS for hooks/UI consumption
export { PaymentRoute, ROUTE_LABELS } from '@/core/domain/routing'
export type { RouteInput, FeeEstimate }

export interface RoutingUseCase {
  selectRoute(input: RouteInput): PaymentRoute
  findCommonMints(senderMints: string[], receiverMints: string[]): string[]
  // my-wallet 견적은 estimateRouteFee(LN_CROSS_MINT/...)가 내부 위임으로 처리
  // — SendConfirmStep의 이중 견적 제거(§8.4) 후 별도 표면의 소비자가 없어
  // driving port에서 제거했다 (7단계 리뷰 #5). adapter의 estimateMyWalletFee는
  // estimateRouteFee의 위임 대상으로 존속한다.
  estimateRouteFee(
    route: PaymentRoute,
    sourceMint: string,
    amount: number,
    targetMint?: string,
    invoice?: string,
  ): Promise<FeeEstimate>
}
