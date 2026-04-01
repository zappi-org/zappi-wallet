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
  ReceiveParams,
  ReceiveRequest,
  RedeemResult,
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
  receiveToken(token: string): Promise<{ amount: number }>
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

  // ─── 보내기 ───

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

  // ─── 받기 요청 ───

  async createReceiveRequest(_params: ReceiveParams): Promise<ReceiveRequest> {
    // creq 생성은 CashuModule이 조율 (keyring + relay + nostr 재료 필요)
    throw new Error('Use CashuModule.createReceiveRequest() for ecash receive requests')
  }

  // ─── 받기 실행 (redeem) ───

  async redeem(input: string): Promise<RedeemResult> {
    const { amount } = await this.backend.receiveToken(input)
    return { requestId: '', amount: sat(amount), method: 'ecash', protocol: 'cashu-token', completed: true }
  }

  // ─── 복구 ───

  async recoverPending(): Promise<RecoveryReport> {
    const result = await this.backend.recoverPendingSendTokens()
    return { recovered: result.reclaimed, failed: 0 }
  }
}
