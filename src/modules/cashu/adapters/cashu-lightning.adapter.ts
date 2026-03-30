/**
 * CashuLightningAdapter — PaymentMethodAdapter for Lightning (melt/mint)
 *
 * execute-route.ts의 executeMeltFlow / estimateMeltFee 로직을 adapter로 추출.
 * CashuBackend를 주입받아 Coco SDK에 의존하지 않음.
 */

import type {
  PaymentMethodAdapter,
  SendParams,
  PreparedPayment,
  ExecutingPayment,
  ReceiveParams,
  ReceiveRequest,
  FeeEstimate,
  ParsedInput,
  RecoveryReport,
} from '@/core/ports/driven/payment-method.port'
import { sat, toNumber } from '@/core/domain/amount'

// ─── Backend interface (DI용) ───

export interface LightningBackend {
  prepareMelt(mintUrl: string, invoice: string): Promise<{
    operationId: string
    quoteId: string
    amount: number
    fee_reserve: number
    swap_fee: number
  }>
  executeMelt(operationId: string): Promise<{ state: string }>
  rollbackMelt(operationId: string, reason?: string): Promise<void>
  createMintQuote(mintUrl: string, amount: number): Promise<{
    quote: string
    request: string
    expiry: number
  }>
  redeemMintQuote(mintUrl: string, quoteId: string, expectedAmount: number): Promise<void>
  recoverPendingMelts(): Promise<{ recovered: number; failed: number }>
}

// ─── Adapter ───

export class CashuLightningAdapter implements PaymentMethodAdapter {
  readonly id = 'cashu:lightning'
  readonly moduleId = 'cashu'
  readonly supportedUnits = ['sat']
  readonly capabilities = {
    canSend: true,
    canReceive: true,
    canEstimateFee: true,
  }

  constructor(private backend: LightningBackend) {}

  parseInput(input: string): ParsedInput | null {
    // bolt11 invoice detection
    const lower = input.toLowerCase().trim()
    if (lower.startsWith('lnbc') || lower.startsWith('lntb') || lower.startsWith('lnbcrt')) {
      return {
        method: 'lightning',
        protocol: 'bolt11',
        destination: input.trim(),
      }
    }

    // lightning address detection
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.trim())) {
      return {
        method: 'lightning',
        protocol: 'lnurl',
        destination: input.trim(),
      }
    }

    return null
  }

  async createReceiveRequest(params: ReceiveParams): Promise<ReceiveRequest> {
    const amount = toNumber(params.amount)
    const quote = await this.backend.createMintQuote(params.mintUrl, amount)

    return {
      id: quote.quote,
      method: 'lightning',
      protocol: 'bolt11',
      encoded: quote.request,
      amount: params.amount,
      expiresAt: quote.expiry * 1000,
    }
  }

  async estimateFee(params: SendParams): Promise<FeeEstimate> {
    const invoice = params.destination
    let meltOp: Awaited<ReturnType<LightningBackend['prepareMelt']>> | null = null

    try {
      meltOp = await this.backend.prepareMelt(params.mintUrl, invoice)
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
    const meltOp = await this.backend.prepareMelt(params.mintUrl, params.destination)
    const fee = meltOp.fee_reserve + meltOp.swap_fee

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
    const result = await this.backend.executeMelt(preparedId)
    return { id: preparedId, state: result.state }
  }

  async cancelPrepared(preparedId: string): Promise<void> {
    await this.backend.rollbackMelt(preparedId, 'cancelled by user')
  }

  async reclaimFailed(operationId: string): Promise<void> {
    await this.backend.rollbackMelt(operationId, 'reclaim failed operation')
  }

  async recoverPending(): Promise<RecoveryReport> {
    return this.backend.recoverPendingMelts()
  }
}
