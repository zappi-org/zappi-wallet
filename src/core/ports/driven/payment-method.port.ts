import type { Amount } from '@/core/domain/amount'

export interface PaymentMethodAdapter {
  readonly id: string            // 'cashu:bolt11', 'cashu:bolt12', 'cashu:ecash'
  readonly moduleId: string
  readonly protocol: 'bolt11' | 'bolt12' | 'ecash'
  readonly supportedUnits: string[]
  readonly capabilities: {
    canSend: boolean
    canReceive: boolean
    canEstimateFee: boolean
  }

  // ─── 보내기 ───
  estimateFee(params: SendParams): Promise<FeeEstimate>
  prepareSend(params: SendParams): Promise<PreparedPayment>
  executeSend(preparedId: string): Promise<ExecutingPayment>
  cancelPrepared(preparedId: string): Promise<void>
  reclaimFailed(operationId: string): Promise<void>
  finalizeSend?(operationId: string): Promise<void>

  // ─── 받기 요청 (상대방에게 "나에게 보내줘") ───
  createReceiveRequest(params: ReceiveParams): Promise<ReceiveRequest>

  // ─── 받기 실행 (이미 존재하는 것을 내 지갑에 넣기) ───
  redeem?(input: string): Promise<RedeemResult>

  // ─── 수신 완료 감지 (비동기 수신 — invoice paid, swap 완료 등) ───
  onReceiveCompleted?(
    requestId: string,
    handler: (result: ReceiveCompletedResult) => void,
  ): () => void

  // ─── 복구 ───
  recoverPending(): Promise<RecoveryReport>
}

export interface SendParams {
  destination?: string
  amount: Amount
  accountId: string
  memo?: string
  options?: Record<string, unknown>
}

export interface PreparedPayment {
  id: string
  method: string
  protocol: string
  amount: Amount
  fee: Amount
  memo?: string
}

export interface ReceiveParams {
  amount: Amount
  accountId: string
  description?: string
  protocol?: string
}

export interface ReceiveRequest {
  id: string
  method: string
  protocol: string
  encoded: string
  amount: Amount
  expiresAt?: number
}

export interface FeeEstimate {
  fee: Amount
  method: string
  protocol: string
}

export interface ExecutingPayment {
  id: string
  state: string
  data?: Record<string, unknown>
}

export interface RedeemResult {
  requestId: string
  amount: Amount
  method: string
  protocol: string
  completed: boolean
  accountId?: string
}

export interface ReceiveCompletedResult {
  requestId: string
  amount: Amount
  completedAt: number
}

export interface RecoveryDetail {
  id: string
  kind: string
  status: 'recovered' | 'failed' | 'expired'
  error?: string
}

export interface RecoveryReport {
  recovered: number
  failed: number
  details?: RecoveryDetail[]
}
