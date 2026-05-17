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
import type { Transaction } from '@/core/domain/transaction'
import type { TransferOperator, TransferIntent, MessageTransport } from '@/core/ports/driven/transfer-operator.port'
import type { TokenCodec } from '@/core/ports/driven/token-codec.port'
import type { PendingTransfer, TransferPhase } from '@/core/domain/pending-transfer'
import { createPendingTransfer, transitionPhase, isExpired } from '@/core/domain/pending-transfer'

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

import type { ProofStateResult } from '@/core/ports/driven/send-token-operator.port'

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
  checkProofStates(token: string): Promise<ProofStateResult>
  getSendOperationState(operationId: string): Promise<string | null>
}

// ─── Constants ───

const TOKEN_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

// ─── Adapter ───

export class CashuEcashAdapter implements PaymentMethodAdapter, TransferOperator {
  readonly id = 'cashu:ecash'
  readonly moduleId = 'cashu'
  readonly protocol = 'ecash'
  readonly supportedUnits = ['sat']
  readonly capabilities = {
    canSend: true,
    canReceive: true,
    canEstimateFee: true,
  }

  private pendingMemos = new Map<string, string>()

  constructor(
    private backend: EcashBackend,
    private transport?: MessageTransport,
    private tokenCodec?: TokenCodec,
  ) { }

  // ─── TransferOperator ───

  async prepare(intent: TransferIntent): Promise<PendingTransfer> {
    const prepared = await this.backend.prepareSend({
      mintUrl: intent.accountId,
      amount: toNumber(intent.amount),
    })

    return createPendingTransfer({
      id: crypto.randomUUID(),
      txId: intent.txId,
      direction: 'outgoing',
      finality: 'deferred',
      onExpiry: 'reclaim',
      expiresAt: Date.now() + TOKEN_TTL,
      transportRef: {
        type: 'ecash-token',
        operationId: prepared.operationId,
        recipient: intent.recipient,
        amount: toNumber(intent.amount), // Transaction 생성용
        mintUrl: intent.accountId, // Transaction 생성용
      },
      now: Date.now(),
    })
  }

  async execute(transfer: PendingTransfer): Promise<PendingTransfer> {
    // incoming: redeem (사용자가 "받기" 클릭)
    if (transfer.direction === 'incoming') {
      return this.executeIncoming(transfer)
    }

    // outgoing: 토큰 생성 + 전송
    return this.executeOutgoing(transfer)
  }

  async processIncoming(transfer: PendingTransfer): Promise<PendingTransfer> {
    return this.executeIncoming(transfer)
  }

  private async executeOutgoing(transfer: PendingTransfer): Promise<PendingTransfer> {
    const ref = transfer.transportRef as {
      operationId: string
      recipient?: string
    }

    // 1. 토큰 생성
    const memo = this.pendingMemos.get(ref.operationId)
    this.pendingMemos.delete(ref.operationId)
    const result = await this.backend.executeSend(ref.operationId, { memo })

    // 2. 전송 (recipient 있을 때만 — QR/클립보드는 전송 없음)
    let deliveryId: string | undefined
    if (ref.recipient && this.transport) {
      const publishResult = await this.transport.publish({
        recipient: ref.recipient,
        content: result.token,
      })
      deliveryId = publishResult.deliveryId
    }

    // 기존 transportRef 유지하면서 token 추가
    const prevRef = transfer.transportRef as {
      type: string
      operationId: string
      recipient?: string
      amount: number
      mintUrl: string
    }

    return {
      ...transitionPhase(transfer, 'submitted', Date.now()),
      transportRef: {
        ...prevRef,
        token: result.token,
        deliveryId,
      },
    } as PendingTransfer
  }

  private async executeIncoming(transfer: PendingTransfer): Promise<PendingTransfer> {
    const ref = transfer.transportRef as {
      content?: string
      token?: string
    }

    // content에서 token 추출 또는 저장된 token 사용
    const token = ref.token ?? this.extractTokenFromContent(ref.content ?? '')
    if (!token) {
      throw new Error('No token found in incoming transfer')
    }

    // redeem
    await this.backend.receiveToken(token)

    return transitionPhase(transfer, 'settled', Date.now())
  }

  private extractTokenFromContent(content: string): string | undefined {
    const trimmed = content.trim()
    if (/^cashu[ab]/i.test(trimmed)) return trimmed
    // JSON proofs → encoded token (backend.receiveToken expects encoded form)
    if (trimmed.startsWith('{"mint"') || trimmed.includes('"proofs"')) {
      if (!this.tokenCodec) return undefined
      try {
        const parsed = JSON.parse(trimmed) as { mint?: string; unit?: string; proofs?: unknown[]; memo?: string }
        if (!parsed.mint || !Array.isArray(parsed.proofs)) return undefined
        return this.tokenCodec.encodeCashuToken({
          mint: parsed.mint,
          unit: parsed.unit ?? 'sat',
          proofs: parsed.proofs as import('@/core/domain/cashu-payment-payload').CashuProof[],
          memo: parsed.memo,
        })
      } catch {
        return undefined
      }
    }
    return undefined
  }

  async poll(transfer: PendingTransfer): Promise<TransferPhase> {
    const ref = transfer.transportRef as {
      operationId?: string
      token?: string
    }

    // 1. SDK 내부 상태 먼저 확인
    if (ref.operationId) {
      const opState = await this.backend.getSendOperationState(ref.operationId)
      if (opState === 'finalized') return 'settled'
      if (opState === 'rolled_back') return 'recoverable'
    }

    // 2. 토큰 체인 상태 확인
    if (ref.token) {
      const proofState = await this.backend.checkProofStates(ref.token)
      if (proofState.allSpent) return 'settled'
      if (proofState.allPending) return 'awaiting_confirmation'
    }

    // 3. 만료 체크
    if (isExpired(transfer)) return 'recoverable'

    return 'awaiting_confirmation'
  }

  async reclaim(transfer: PendingTransfer): Promise<void> {
    const ref = transfer.transportRef as { operationId: string }
    await this.backend.rollbackSend(ref.operationId)
  }

  // ─── 보내기 ───

  async estimateFee(params: SendParams): Promise<FeeEstimate> {
    try {
      const prepared = await this.backend.prepareSend({
        mintUrl: params.accountId,
        amount: toNumber(params.amount),
      })
      const fee = prepared.fee
      await this.backend.rollbackSend(prepared.operationId).catch(() => { })
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
      // 원본 토큰 저장 — Token tab Detail/RawSheet 에서 audit 용도로 조회
      metadata: { token: input },
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

  // ─── Reclaim 견적 ───
  /**
   * Cashu 토큰은 tx.metadata.token 에 저장됨. Reclaim swap 은 receive swap 과
   * 같은 input_fee_ppk 를 적용하므로 estimateRedeemFee 로 위임한다.
   */
  async estimateReclaimFee(tx: Transaction): Promise<RedeemFeeEstimate> {
    const token = tx.metadata?.token as string | undefined
    if (!token) {
      throw new Error('No cashu token stored in transaction metadata')
    }
    return this.estimateRedeemFee(token)
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
