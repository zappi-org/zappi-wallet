/**
 * CashuBolt11Adapter — PaymentMethodAdapter for bolt11 Lightning (melt/mint)
 *
 * execute-route.ts의 executeMeltFlow / estimateMeltFee 로직을 adapter로 추출.
 * CashuBackend를 주입받아 Coco SDK에 의존하지 않음.
 */

import type {
  CheckAliveParams,
  PaymentMethodAdapter,
  SendParams,
  PreparedPayment,
  ExecutingPayment,
  ReceiveParams,
  ReceiveRequest,
  FeeEstimate,
  RecoveryReport,
  ReceiveCompletedResult,
} from '@/core/ports/driven/payment-method.port'
import type { Amount } from '@/core/domain/amount'
import { sat, toNumber, amount as amt } from '@/core/domain/amount'

// ─── Backend interface (DI용) ───

export interface LightningBackend {
  prepareMelt(mintUrl: string, invoice: string): Promise<{
    operationId: string
    quoteId: string
    amount: number
    fee_reserve: number
    swap_fee: number
    unit: string
  }>
  executeMelt(operationId: string): Promise<{
    state: string
    preimage?: string
    effectiveFee?: number
    changeAmount?: number
  }>
  rollbackMelt(operationId: string, reason?: string): Promise<void>
  createMintQuote(mintUrl: string, amount: number): Promise<{
    quote: string
    request: string
    expiry: number
  }>
  redeemMintQuote(mintUrl: string, quoteId: string, expectedAmount: number): Promise<void>
  getMintQuote(mintUrl: string, quoteId: string): Promise<{ state: string; request: string } | null>
  checkMintQuote(mintUrl: string, quoteId: string): Promise<{ state: string } | null>
  recoverPendingMelts(): Promise<{ recovered: number; failed: number }>
  recoverPendingQuotes(): Promise<{ recovered: number; failed: number; expired: number }>
  onMintQuotePaid?(quoteId: string, handler: () => void): () => void
}

// ─── Adapter ───

export class CashuBolt11Adapter implements PaymentMethodAdapter {
  readonly id = 'cashu:bolt11'
  readonly moduleId = 'cashu'
  readonly protocol = 'bolt11' as const
  readonly supportedUnits = ['sat']
  readonly capabilities = {
    canSend: true,
    canReceive: true,
    canEstimateFee: true,
  }

  private preparingPayments = new Map<string, {
    operationId: string
    unit: string
    effectiveFee?: Amount
  }>()

  constructor(private backend: LightningBackend) {}

  // ─── 보내기 ───

  async estimateFee(params: SendParams): Promise<FeeEstimate> {
    const invoice = params.destination!
    let meltOp: Awaited<ReturnType<LightningBackend['prepareMelt']>> | null = null

    try {
      meltOp = await this.backend.prepareMelt(params.accountId, invoice)
      const fee = meltOp.fee_reserve + meltOp.swap_fee
      await this.backend.rollbackMelt(meltOp.operationId, 'fee estimation only').catch(() => {})
      return { fee: sat(fee), method: 'lightning', protocol: 'bolt11' }
    } catch {
      if (meltOp) {
        await this.backend.rollbackMelt(meltOp.operationId, 'fee estimation failed').catch(() => {})
      }
      return { fee: sat(0), method: 'lightning', protocol: 'bolt11' }
    }
  }

  async prepareSend(params: SendParams): Promise<PreparedPayment> {
    const meltOp = await this.backend.prepareMelt(params.accountId, params.destination!)
    const fee = meltOp.fee_reserve + meltOp.swap_fee

    // Store unit for execute() phase
    this.preparingPayments.set(meltOp.operationId, {
      operationId: meltOp.operationId,
      unit: meltOp.unit,
    })

    return {
      id: meltOp.operationId,
      method: 'lightning',
      protocol: 'bolt11',
      amount: sat(meltOp.amount),
      fee: sat(fee),
      memo: params.memo,
    }
  }

  async executeSend(preparedId: string): Promise<ExecutingPayment> {
    const pending = this.preparingPayments.get(preparedId)
    if (!pending) {
      throw new Error(`No pending payment: ${preparedId}`)
    }

    const result = await this.backend.executeMelt(preparedId)

    // Propagate effectiveFee with stored unit
    let effectiveFee: Amount | undefined
    if (result.state === 'finalized' && result.effectiveFee !== undefined) {
      effectiveFee = amt(result.effectiveFee, pending.unit as 'sat' | 'msat' | 'usd' | 'eur')
      // Store in pending for potential later retrieval
      pending.effectiveFee = effectiveFee
    }

    this.preparingPayments.delete(preparedId)

    return {
      id: preparedId,
      state: result.state,
      data: result.preimage ? { preimage: result.preimage } : undefined,
      effectiveFee,
    }
  }

  async cancelPrepared(preparedId: string): Promise<void> {
    await this.backend.rollbackMelt(preparedId, 'cancelled by user')
  }

  async reclaimFailed(operationId: string): Promise<void> {
    await this.backend.rollbackMelt(operationId, 'reclaim failed operation')
  }

  // ─── Redeem (bolt11은 redeem 미지원) ───

  canRedeem(_input: string): boolean {
    return false
  }

  // ─── 받기 요청 ───

  async createReceiveRequest(params: ReceiveParams): Promise<ReceiveRequest> {
    const amount = toNumber(params.amount)
    const quote = await this.backend.createMintQuote(params.accountId, amount)

    return {
      id: quote.quote,
      method: 'bolt11',
      protocol: 'bolt11',
      encoded: quote.request,
      amount: params.amount,
      expiresAt: quote.expiry * 1000,
    }
  }

  // ─── 수신 완료 감지 ───

  onReceiveCompleted(
    requestId: string,
    handler: (result: ReceiveCompletedResult) => void,
  ): () => void {
    if (!this.backend.onMintQuotePaid) {
      return () => {}
    }
    return this.backend.onMintQuotePaid(requestId, () => {
      handler({
        requestId,
        amount: sat(0),
        completedAt: Date.now(),
      })
    })
  }

  async checkAlive(params: CheckAliveParams): Promise<boolean> {
    if (!params.accountId) {
      return true
    }

    const quote = await this.backend.checkMintQuote(params.accountId, params.requestId)
    return quote?.state === 'UNPAID' || quote?.state === 'PAID' || quote?.state === 'ISSUED'
  }

  // ─── 복구 ───

  async recoverPending(): Promise<RecoveryReport> {
    const [melts, quotes] = await Promise.allSettled([
      this.backend.recoverPendingMelts(),
      this.backend.recoverPendingQuotes(),
    ])
    const meltResult = melts.status === 'fulfilled' ? melts.value : { recovered: 0, failed: 0 }
    const quoteResult = quotes.status === 'fulfilled' ? quotes.value : { recovered: 0, failed: 0 }
    return {
      recovered: meltResult.recovered + quoteResult.recovered,
      failed: meltResult.failed + quoteResult.failed,
    }
  }
}
