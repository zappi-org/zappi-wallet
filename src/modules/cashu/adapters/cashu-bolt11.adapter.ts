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
import type { TransferOperator, TransferIntent } from '@/core/ports/driven/transfer-operator.port'
import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'
import { createPendingTransfer, transitionPhase, isExpired } from '@/core/domain/pending-transfer'


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
  checkMelt(operationId: string): Promise<{
    state: string
    preimage?: string
    error?: string
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

export class CashuBolt11Adapter implements PaymentMethodAdapter, TransferOperator {
  readonly id = 'cashu:bolt11'
  readonly moduleId = 'cashu'
  readonly protocol = 'bolt11'
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

  constructor(private backend: LightningBackend) { }

  // ─── TransferOperator (Outgoing) ───

  async prepare(intent: TransferIntent): Promise<PendingTransfer> {
    const op = await this.backend.prepareMelt(intent.accountId, intent.recipient!)

    return createPendingTransfer({
      id: crypto.randomUUID(),
      txId: intent.txId,
      direction: 'outgoing',
      finality: 'immediate',
      onExpiry: 'fail',
      transportRef: {
        type: 'bolt11-melt',
        quoteId: op.quoteId,
        operationId: op.operationId,
        request: intent.recipient,
        mintUrl: intent.accountId,
        feeReserve: op.fee_reserve,
      },
      now: Date.now(),
      amount: op.amount
    })
  }

  async execute(transfer: PendingTransfer): Promise<PendingTransfer> {
    const ref = transfer.transportRef as { operationId: string }
    const result = await this.backend.executeMelt(ref.operationId)

    // preimage 즉시 확인 → 완료
    if (result.preimage || result.state === 'PAID' || result.state === 'finalized') {
      const updatedRef = {
        ...ref,
        ...(result.preimage && { preimage: result.preimage }),
        ...(result.effectiveFee != null && { effectiveFee: result.effectiveFee }),
      }
      const updatedTransfer = {
        ...transfer,
        transportRef: updatedRef,
      }
      return transitionPhase(updatedTransfer, 'settled', Date.now())
    }

    // 에러 즉시 실패
    if (result.state === 'FAILED') {
      return transitionPhase(transfer, 'failed', Date.now())
    }

    // 아직 처리 중 → 폴링 대상
    return transitionPhase(transfer, 'in_transit', Date.now())
  }

  // ─── TransferOperator (Incoming) ───

  async prepareReceive(intent: TransferIntent): Promise<PendingTransfer> {
    const quote = await this.backend.createMintQuote(intent.accountId, toNumber(intent.amount))

    return createPendingTransfer({
      id: crypto.randomUUID(),
      txId: intent.txId,
      direction: 'incoming',
      finality: 'deferred',
      onExpiry: 'expire',
      expiresAt: quote.expiry * 1000,
      amount: toNumber(intent.amount),
      transportRef: {
        type: 'bolt11-mint',
        quoteId: quote.quote,
        request: quote.request,
        mintUrl: intent.accountId,
        amount: toNumber(intent.amount),
      },
      now: Date.now(),
    })
  }

  async claimReceive(transfer: PendingTransfer): Promise<PendingTransfer> {
    const ref = transfer.transportRef as { mintUrl: string; quoteId: string }
    // SDK watcher가 이미 자동 민팅했을 수 있음 — idempotency check
    const status = await this.backend.checkMintQuote(ref.mintUrl, ref.quoteId)
    if (status?.state === 'ISSUED' || status?.state === 'finalized') {
      return transitionPhase(transfer, 'settled', Date.now())
    }
    await this.backend.redeemMintQuote(ref.mintUrl, ref.quoteId, 0)
    return transitionPhase(transfer, 'settled', Date.now())
  }

  async poll(transfer: PendingTransfer): Promise<TransferPhase> {
    if (transfer.direction === 'incoming') {
      const ref = transfer.transportRef as { mintUrl: string; quoteId: string }

      // Local expiry pre-check: SDK throws on EXPIRED (not in its state machine),
      // so a thrown error would be caught at the poll loop and the transfer
      // would stay in 'submitted' forever, hitting the mint every 5s.
      if (isExpired(transfer)) return 'failed'

      let status: Awaited<ReturnType<LightningBackend['checkMintQuote']>> | null = null
      try {
        status = await this.backend.checkMintQuote(ref.mintUrl, ref.quoteId)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        // SDK throws "Unexpected mint quote state: EXPIRED" — treat as terminal.
        if (msg.includes('EXPIRED')) return 'failed'
        throw error
      }

      if (!status) return 'failed'
      if (status.state === 'ISSUED') return 'settled'
      if (status.state === 'PAID') return 'awaiting_confirmation'
      if (status.state === 'EXPIRED') return 'failed'
      if (isExpired(transfer)) return 'failed'
      return 'submitted'
    }

    // outgoing melt
    const ref = transfer.transportRef as { operationId: string }
    const status = await this.backend.checkMelt(ref.operationId)

    if (status.preimage || status.state === 'PAID' || status.state === 'finalized') {
      return 'settled'
    }
    if (status.state === 'FAILED' || status.error) {
      return 'failed'
    }
    if (isExpired(transfer)) {
      return 'failed'
    }
    return 'in_transit'
  }



  // ─── 보내기 ───

  async estimateFee(params: SendParams): Promise<FeeEstimate> {
    const invoice = params.destination!
    let meltOp: Awaited<ReturnType<LightningBackend['prepareMelt']>> | null = null

    try {
      meltOp = await this.backend.prepareMelt(params.accountId, invoice)
      const fee = meltOp.fee_reserve + meltOp.swap_fee
      await this.backend.rollbackMelt(meltOp.operationId, 'fee estimation only').catch(() => { })
      return { fee: sat(fee), method: 'lightning', protocol: 'bolt11' }
    } catch {
      if (meltOp) {
        await this.backend.rollbackMelt(meltOp.operationId, 'fee estimation failed').catch(() => { })
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
      return () => { }
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

  async queryReceiveStatus(params: CheckAliveParams): Promise<{ state: string }> {
    if (!params.accountId) {
      return { state: 'UNKNOWN' }
    }
    const quote = await this.backend.checkMintQuote(params.accountId, params.requestId)
    return { state: quote?.state ?? 'UNKNOWN' }
  }

  async claimReceiveRequest(params: { requestId: string; accountId: string }): Promise<{ amount: Amount }> {
    const quote = await this.backend.checkMintQuote(params.accountId, params.requestId)
    if (!quote) {
      throw new Error('Quote not found')
    }
    // Redeem the paid quote — backend resolves the actual amount internally
    await this.backend.redeemMintQuote(params.accountId, params.requestId, 0)
    return { amount: sat(0) }
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
