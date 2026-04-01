import type { Amount } from '@/core/domain/amount'

export interface PaymentMethodAdapter {
  readonly id: string            // 'cashu:lightning', 'fedi:ecash'
  readonly moduleId: string
  readonly supportedUnits: string[]
  readonly capabilities: {
    canSend: boolean
    canReceive: boolean
    canEstimateFee: boolean
  }

  parseInput?(input: string): ParsedInput | null
  createReceiveRequest?(params: ReceiveParams): Promise<ReceiveRequest>
  estimateFee(params: SendParams): Promise<FeeEstimate>
  prepareSend(params: SendParams): Promise<PreparedPayment>
  executeSend(preparedId: string): Promise<ExecutingPayment>
  cancelPrepared(preparedId: string): Promise<void>
  reclaimFailed(operationId: string): Promise<void>
  recoverPending(): Promise<RecoveryReport>

  /** ecash token 직접 수신 (cashu:ecash 등) */
  receiveToken?(token: string): Promise<ReceiveCompletedResult>

  /** 수신 완료 콜백 등록 (Lightning invoice paid, swap 완료 감지용) */
  onReceiveCompleted?(
    requestId: string,
    handler: (result: ReceiveCompletedResult) => void,
  ): () => void
}

export interface SendParams {
  destination: string
  amount: Amount
  accountId: string
  memo?: string
  /** adapter-specific options (P2PK target 등) */
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
  /** adapter-specific result data (ecash: { token: "cashuA..." } 등) */
  data?: Record<string, unknown>
}

export interface ParsedInput {
  method: string
  protocol: string
  destination: string
  amount?: Amount
}

export interface RecoveryReport {
  recovered: number
  failed: number
}

export interface ReceiveCompletedResult {
  requestId: string
  amount: Amount
  completedAt: number
}
