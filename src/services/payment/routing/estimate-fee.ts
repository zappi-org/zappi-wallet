/**
 * Route Fee Estimation
 *
 * 각 라우트별 수수료를 비파괴적으로 추정한다.
 * prepare → 수수료 확인 → 즉시 rollback 패턴 사용.
 */

import { PaymentRoute } from './types'
import {
  prepareSendToken,
  rollbackSendToken,
  prepareMelt,
  rollbackMelt,
  createMintQuote,
} from '@/coco/cashuService'

export interface FeeEstimate {
  /** Estimated fee in sats */
  fee: number
  /** Total amount needed (amount + fee) */
  totalNeeded: number
}

/**
 * 라우트별 수수료 추정.
 * 모든 경로에서 prepare+rollback 패턴으로 실제 mint에 쿼리한 뒤 즉시 되돌린다.
 *
 * @param invoice — Route #2,#3,#5에서 필요 (bolt11)
 */
export async function estimateRouteFee(
  route: PaymentRoute,
  sourceMint: string,
  amount: number,
  targetMint?: string,
  invoice?: string,
): Promise<FeeEstimate> {
  switch (route) {
    case PaymentRoute.TOKEN_TRANSFER:
    case PaymentRoute.OWN_MINT_TOKEN:
      return estimateTokenFee(sourceMint, amount)

    case PaymentRoute.LN_INTERNAL:
    case PaymentRoute.MELT_TO_LN:
      if (!invoice) return { fee: 0, totalNeeded: amount }
      return estimateMeltFee(sourceMint, invoice)

    case PaymentRoute.LN_CROSS_MINT:
      if (invoice) {
        return estimateMeltFee(sourceMint, invoice)
      }
      // invoice 없으면 target mint에서 quote 생성 후 추정
      if (targetMint) {
        return estimateCrossMintFee(sourceMint, targetMint, amount)
      }
      return { fee: 0, totalNeeded: amount }

    case PaymentRoute.MINT_AND_DM:
      if (!targetMint) return { fee: 0, totalNeeded: amount }
      return estimateMintAndDmFee(sourceMint, targetMint, amount)

    case PaymentRoute.CANNOT_SEND:
    default:
      return { fee: 0, totalNeeded: amount }
  }
}

// ─── Estimators ───

/** Token send fee: swap input_fee only */
async function estimateTokenFee(mintUrl: string, amount: number): Promise<FeeEstimate> {
  try {
    const prepared = await prepareSendToken(mintUrl, amount)
    const fee = prepared.fee
    await rollbackSendToken(prepared.operationId).catch((e) =>
      console.error('[estimateTokenFee] rollback failed:', e),
    )
    return { fee, totalNeeded: amount + fee }
  } catch {
    return { fee: 0, totalNeeded: amount }
  }
}

/** Melt fee: fee_reserve + swap_fee */
async function estimateMeltFee(mintUrl: string, invoice: string): Promise<FeeEstimate> {
  try {
    const meltOp = await prepareMelt(mintUrl, invoice)
    const fee = meltOp.fee_reserve + meltOp.swap_fee
    await rollbackMelt(meltOp.operationId, 'fee estimation only').catch((e) =>
      console.error('[estimateMeltFee] rollback failed:', e),
    )
    return { fee, totalNeeded: meltOp.amount + fee }
  } catch (e) {
    console.warn('[estimateMeltFee] failed:', e)
    return { fee: 0, totalNeeded: 0 }
  }
}

/** Cross-mint fee: create mint quote on target → melt quote on source → rollback */
async function estimateCrossMintFee(
  sourceMint: string,
  targetMint: string,
  amount: number,
): Promise<FeeEstimate> {
  try {
    const mintQuote = await createMintQuote(targetMint, amount)
    const meltOp = await prepareMelt(sourceMint, mintQuote.request)
    const fee = meltOp.fee_reserve + meltOp.swap_fee
    await rollbackMelt(meltOp.operationId, 'fee estimation only').catch((e) =>
      console.error('[estimateCrossMintFee] rollback failed:', e),
    )
    return { fee, totalNeeded: meltOp.amount + fee }
  } catch {
    return { fee: 0, totalNeeded: amount }
  }
}

/** Mint+DM fee: cross-mint LN fee + token send fee on target */
async function estimateMintAndDmFee(
  sourceMint: string,
  targetMint: string,
  amount: number,
): Promise<FeeEstimate> {
  try {
    // Parallel: LN cross-mint fee + token send fee on target (independent mints)
    const [lnFee, tokenFee] = await Promise.all([
      estimateCrossMintFee(sourceMint, targetMint, amount),
      estimateTokenFee(targetMint, amount),
    ])

    const totalFee = lnFee.fee + tokenFee.fee
    return { fee: totalFee, totalNeeded: amount + totalFee }
  } catch {
    return { fee: 0, totalNeeded: amount }
  }
}
