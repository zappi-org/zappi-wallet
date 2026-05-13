import { classifyCashuError } from '@/modules/cashu/internal/classify-error'
import type {
  PreparedRouteMelt,
  RouteLockingCondition,
  RoutePaymentOperator,
} from '@/core/ports/driven/route-payment-operator.port'

export interface CashuRoutePaymentOperatorBackend {
  createMintQuote(mintUrl: string, amount: number): Promise<{ quote: string; request: string }>
  prepareMelt(mintUrl: string, invoice: string): Promise<{
    operationId: string
    quoteId: string
    amount: number
    fee_reserve?: number
    swap_fee?: number
  }>
  executeMelt(operationId: string): Promise<{
    state: string
    preimage?: string
    effectiveFee?: number
    changeAmount?: number
  }>
  rollbackMelt(operationId: string, reason?: string): Promise<void>
  redeemMintQuote(mintUrl: string, quoteId: string, amount: number): Promise<void>
  prepareSend(params: {
    mintUrl: string
    amount: number
    lockingCondition?: RouteLockingCondition
  }): Promise<{ operationId: string; fee?: number }>
  executeSend(operationId: string, options?: { memo?: string }): Promise<{ token: string }>
  rollbackSend(operationId: string): Promise<void>
}

export interface CashuRoutePaymentQuoteTracker {
  markQuoteAsSwap(quoteId: string): void
  unmarkQuoteAsSwap(quoteId: string): void
}

export class CashuRoutePaymentOperatorAdapter implements RoutePaymentOperator {
  constructor(
    private readonly backend: CashuRoutePaymentOperatorBackend,
    private readonly quoteTracker: CashuRoutePaymentQuoteTracker,
  ) {}

  async createMintQuote(mintUrl: string, amount: number) {
    return this.run(() => this.backend.createMintQuote(mintUrl, amount))
  }

  markMintQuoteAsSwap(quoteId: string): void {
    this.quoteTracker.markQuoteAsSwap(quoteId)
  }

  unmarkMintQuoteAsSwap(quoteId: string): void {
    this.quoteTracker.unmarkQuoteAsSwap(quoteId)
  }

  async prepareMelt(mintUrl: string, invoice: string): Promise<PreparedRouteMelt> {
    const result = await this.run(() => this.backend.prepareMelt(mintUrl, invoice))
    return {
      operationId: result.operationId,
      quoteId: result.quoteId,
      amount: result.amount,
      feeReserve: result.fee_reserve ?? 0,
      swapFee: result.swap_fee ?? 0,
    }
  }

  async executeMelt(operationId: string) {
    return this.run(() => this.backend.executeMelt(operationId))
  }

  async rollbackMelt(operationId: string, reason: string): Promise<void> {
    await this.run(() => this.backend.rollbackMelt(operationId, reason))
  }

  async redeemMintQuote(mintUrl: string, quoteId: string, amount: number): Promise<void> {
    await this.run(() => this.backend.redeemMintQuote(mintUrl, quoteId, amount))
  }

  async prepareTokenSend(params: {
    mintUrl: string
    amount: number
    lockingCondition?: RouteLockingCondition
  }) {
    const result = await this.run(() => this.backend.prepareSend(params))
    return {
      operationId: result.operationId,
      fee: result.fee ?? 0,
    }
  }

  async executeTokenSend(operationId: string, options?: { memo?: string }) {
    return this.run(() => this.backend.executeSend(operationId, options))
  }

  async rollbackTokenSend(operationId: string): Promise<void> {
    await this.run(() => this.backend.rollbackSend(operationId))
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation()
    } catch (error) {
      throw classifyCashuError(error)
    }
  }
}
