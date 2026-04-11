/**
 * CashuEcashAdapter — PaymentMethodAdapter for eCash token send/receive
 *
 * execute-route.ts의 executeTokenSendFlow 로직을 adapter로 추출.
 * EcashBackend를 주입받아 Coco SDK에 직접 의존하지 않음.
 */

import type {
  PaymentMethodAdapter,
  InputInspection,
  SendParams,
  PreparedPayment,
  ExecutingPayment,
  FeeEstimate,
  RecoveryReport,
  ReceiveParams,
  ReceiveRequest,
  RedeemResult,
} from '@/core/ports/driven/payment-method.port'
import { amount as toAmount, sat, toNumber } from '@/core/domain/amount'
import type { Unit } from '@/core/domain/amount'
import type { RedeemFeeEstimate } from '@/core/ports/driven/payment-method.port'

// ─── Backend interface (DI용) ───

export interface LockingCondition {
  kind: 'P2PK'
  data: string
  tags?: string[][]
}

/** receiveToken의 반환 타입 — unit은 backend(cashu-backend.ts)가 결정한다 */
export interface ReceivedTokenResult {
  /** 실제 수신 금액 (gross - fee) */
  amount: number
  /** input_fee_ppk 기반 수수료 (0이면 수수료 없음) */
  fee: number
  /** mint의 토큰 단위 — backend가 결정 (현재 항상 'sat', 멀티 유닛 대응 구조) */
  unit: string
  mintUrl: string
}

/** estimateReceiveFee의 반환 타입 */
export interface ReceiveFeeEstimate {
  grossAmount: number
  fee: number
  netAmount: number
  unit: string
  mintUrl: string
}

export interface EcashBackend {
  prepareSend(params: {
    mintUrl: string
    amount: number
    lockingCondition?: LockingCondition
  }): Promise<{ operationId: string; fee: number; needsSwap: boolean }>
  executeSend(operationId: string, options?: { memo?: string }): Promise<{ token: string }>
  rollbackSend(operationId: string): Promise<void>
  finalizeSend(operationId: string): Promise<void>
  receiveToken(token: string): Promise<ReceivedTokenResult>
  estimateReceiveFee(token: string): Promise<ReceiveFeeEstimate>
  recoverPendingSendTokens(): Promise<{ reclaimed: number; recorded: number }>
  redeemPendingReceivedTokens(): Promise<{ redeemed: number; failed: number }>
  storeOfflineToken(token: string, amount: number, mintUrl: string, dleqStatus: 'valid' | 'missing'): Promise<string>
  inspectInput?(token: string): Promise<InputInspection>
}

// ─── Adapter ───

export class CashuEcashAdapter implements PaymentMethodAdapter {
  readonly id = 'cashu:ecash'
  readonly moduleId = 'cashu'
  readonly protocol = 'ecash' as const
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
    const lockingCondition = params.options?.lockingCondition as LockingCondition | undefined

    const prepared = await this.backend.prepareSend({
      mintUrl: params.accountId,
      amount: toNumber(params.amount),
      lockingCondition,
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

  async finalizeSend(operationId: string): Promise<void> {
    await this.backend.finalizeSend(operationId)
  }

  // ─── 받기 요청 ───

  async createReceiveRequest(_params: ReceiveParams): Promise<ReceiveRequest> {
    // creq 생성은 CashuModule이 조율 (keyring + relay + nostr 재료 필요)
    throw new Error('Use CashuModule.createReceiveRequest() for ecash receive requests')
  }

  // ─── 받기 실행 (redeem) ───

  canRedeem(input: string): boolean {
    return /^cashu[ab]/i.test(input.trim())
  }

  async inspectInput(input: string): Promise<InputInspection> {
    if (this.backend.inspectInput) {
      return this.backend.inspectInput(input)
    }
    return { lockStatus: 'not-supported', proofIntegrity: 'not-supported' }
  }

  async redeem(input: string): Promise<RedeemResult> {
    // 메모 추출 (redeem 전에 — receiveToken 후에는 원본 토큰 접근 불가)
    let memo: string | undefined
    try {
      const { getDecodedToken } = await import('@cashu/cashu-ts')
      const decoded = getDecodedToken(input)
      if (decoded.memo) memo = decoded.memo
    } catch { /* ignore decode failure — receiveToken will handle */ }

    const { amount, fee, unit, mintUrl } = await this.backend.receiveToken(input)
    return {
      requestId: crypto.randomUUID(),
      // backend가 결정한 unit으로 Amount 생성 — sat 하드코딩 없음
      amount: toAmount(amount, unit as Unit),
      fee: fee > 0 ? toAmount(fee, unit as Unit) : undefined,
      method: 'cashu:ecash',
      protocol: 'cashu-token',
      completed: true,
      accountId: mintUrl,
      memo,
    }
  }

  async estimateRedeemFee(input: string): Promise<RedeemFeeEstimate> {
    const { grossAmount, fee, netAmount, unit } = await this.backend.estimateReceiveFee(input)
    const u = unit as Unit
    return {
      grossAmount: toAmount(grossAmount, u),
      fee: toAmount(fee, u),
      netAmount: toAmount(netAmount, u),
    }
  }

  // ─── 복구 ───

  async recoverPending(): Promise<RecoveryReport> {
    const [sendResult, recvResult] = await Promise.allSettled([
      this.backend.recoverPendingSendTokens(),
      this.backend.redeemPendingReceivedTokens(),
    ])
    const send = sendResult.status === 'fulfilled' ? sendResult.value : { reclaimed: 0 }
    const recv = recvResult.status === 'fulfilled' ? recvResult.value : { redeemed: 0, failed: 0 }
    return {
      recovered: send.reclaimed + recv.redeemed,
      failed: recv.failed,
    }
  }
}
