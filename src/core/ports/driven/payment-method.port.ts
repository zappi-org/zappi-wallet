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
}

export interface SendParams {
  destination: string
  amount: Amount
  mintUrl: string
  memo?: string
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
  mintUrl: string
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
