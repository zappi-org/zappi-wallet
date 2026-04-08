import type { FeeEstimator } from '@/core/ports/driven/fee-estimator.port'
import type { PaymentRoute, FeeEstimate } from '@/core/domain/routing'
import { PaymentRoute as PR } from '@/core/domain/routing'

export class FeeEstimatorAdapter implements FeeEstimator {
  async estimateRouteFee(
    route: PaymentRoute,
    sourceMint: string,
    amount: number,
    targetMint?: string,
    invoice?: string,
  ): Promise<FeeEstimate> {
    const coco = await import('@/modules/cashu')

    switch (route) {
      case PR.MELT_TO_LN:
      case PR.LN_INTERNAL: {
        if (!invoice) return { fee: 0, totalNeeded: amount }
        const meltResult = await coco.prepareMelt(sourceMint, invoice)
        const fee = (meltResult.fee_reserve ?? 0) + (meltResult.swap_fee ?? 0)
        await coco.rollbackMelt(meltResult.operationId, 'fee_estimation')
        return { fee, totalNeeded: amount + fee }
      }

      case PR.LN_CROSS_MINT: {
        if (!targetMint) return { fee: 0, totalNeeded: amount }
        return this.estimateMyWalletFee(sourceMint, targetMint, amount)
      }

      case PR.TOKEN_TRANSFER:
      case PR.OWN_MINT_TOKEN:
      case PR.MINT_AND_DM: {
        const sendResult = await coco.prepareSendToken(sourceMint, amount)
        const fee = sendResult.fee ?? 0
        await coco.rollbackSendToken(sendResult.operationId)
        return { fee, totalNeeded: amount + fee }
      }

      default:
        return { fee: 0, totalNeeded: amount }
    }
  }

  async estimateMyWalletFee(
    sourceMint: string,
    targetMint: string,
    amount: number,
  ): Promise<FeeEstimate> {
    const coco = await import('@/modules/cashu')

    const quote = await coco.createMintQuote(targetMint, amount)
    const meltResult = await coco.prepareMelt(sourceMint, quote.request)
    const fee = (meltResult.fee_reserve ?? 0) + (meltResult.swap_fee ?? 0)
    await coco.rollbackMelt(meltResult.operationId, 'fee_estimation')

    return { fee, totalNeeded: amount + fee }
  }
}
