import type { PaymentRoute, FeeEstimate } from '@/core/domain/routing'

export interface FeeEstimator {
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
