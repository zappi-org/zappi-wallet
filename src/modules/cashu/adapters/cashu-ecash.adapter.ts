/**
 * CashuEcashAdapter — PaymentMethodAdapter for eCash token send/receive
 *
 * execute-route.ts의 executeTokenSendFlow 로직을 adapter로 추출.
 * EcashBackend를 주입받아 Coco SDK에 직접 의존하지 않음.
 */

import type {
  PaymentMethodAdapter,
  SendParams,
  PreparedPayment,
  ExecutingPayment,
  FeeEstimate,
  RecoveryReport,
  ReceiveCompletedResult,
} from '@/core/ports/driven/payment-method.port'
import { sat, toNumber } from '@/core/domain/amount'

// ─── Backend interface (DI용) ───

export type SendTarget = { type: 'p2pk'; pubkey: string }

export interface EcashBackend {
  prepareSend(params: {
    mintUrl: string
    amount: number
    target?: SendTarget
  }): Promise<{ operationId: string; fee: number; needsSwap: boolean }>
  executeSend(operationId: string, options?: { memo?: string }): Promise<{ token: string }>
  rollbackSend(operationId: string): Promise<void>
  receiveToken(token: string): Promise<void>
  recoverPendingSendTokens(): Promise<{ reclaimed: number; recorded: number }>
}

// ─── Adapter ───

export class CashuEcashAdapter implements PaymentMethodAdapter {
  readonly id = 'cashu:ecash'
  readonly moduleId = 'cashu'
  readonly supportedUnits = ['sat']
  readonly capabilities = {
    canSend: true,
    canReceive: true,
    canEstimateFee: true,
  }

  private pendingMemos = new Map<string, string>()

  constructor(private backend: EcashBackend) {}

  async estimateFee(params: SendParams): Promise<FeeEstimate> {
    try {
      const prepared = await this.backend.prepareSend({
        mintUrl: params.accountId,
        amount: toNumber(params.amount),
      })
      const fee = prepared.fee
      await this.backend.rollbackSend(prepared.operationId).catch(() => {})
      return { fee: sat(fee), method: 'ecash', protocol: 'cashu-token' }
    } catch {
      return { fee: sat(0), method: 'ecash', protocol: 'cashu-token' }
    }
  }

  async prepareSend(params: SendParams): Promise<PreparedPayment> {
    // P2PK target은 options에서 추출
    const target = params.options?.target as SendTarget | undefined

    const prepared = await this.backend.prepareSend({
      mintUrl: params.accountId,
      amount: toNumber(params.amount),
      target,
    })

    if (params.memo) {
      this.pendingMemos.set(prepared.operationId, params.memo)
    }

    return {
      id: prepared.operationId,
      method: 'ecash',
      protocol: 'cashu-token',
      amount: params.amount,
      fee: sat(prepared.fee),
      memo: params.memo,
    }
  }

  async executeSend(preparedId: string): Promise<ExecutingPayment> {
    const memo = this.pendingMemos.get(preparedId)
    this.pendingMemos.delete(preparedId)
    const result = await this.backend.executeSend(preparedId, { memo })
    return {
      id: preparedId,
      state: 'pending',
      data: { token: result.token },
    }
  }

  async cancelPrepared(preparedId: string): Promise<void> {
    this.pendingMemos.delete(preparedId)
    await this.backend.rollbackSend(preparedId)
  }

  async reclaimFailed(operationId: string): Promise<void> {
    await this.backend.rollbackSend(operationId)
  }

  async recoverPending(): Promise<RecoveryReport> {
    const result = await this.backend.recoverPendingSendTokens()
    return { recovered: result.reclaimed, failed: 0 }
  }

  async receiveToken(token: string): Promise<ReceiveCompletedResult> {
    await this.backend.receiveToken(token)
    return {
      requestId: '',
      amount: sat(0), // 실제 금액은 token 파싱으로 확인 — backend에서 제공
      completedAt: Date.now(),
    }
  }
}
