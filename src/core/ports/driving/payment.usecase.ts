import type { Amount } from '@/core/domain/amount'
import type { Result } from '@/core/domain/result'
import type { PaymentError } from '@/core/errors/payment.errors'
import type {
  FeeEstimate,
  ReceiveRequest,
  RedeemResult,
} from '@/core/ports/driven/payment-method.port'
import type { ModuleBalance } from '@/core/ports/driven/wallet-module.port'

/** UI가 adapter를 직접 참조하지 않도록 DTO로 노출 */
export interface PaymentMethodInfo {
  id: string        // 'cashu:bolt11', 'cashu:bolt12', 'cashu:ecash'
  moduleId: string
  protocol: 'bolt11' | 'bolt12' | 'ecash'
  capabilities: {
    canSend: boolean
    canReceive: boolean
    canEstimateFee: boolean
  }
  supportedUnits: string[]
}

export interface PaymentUseCase {
  getAccounts(): Promise<ModuleBalance[]>
  getMethodsForAccount(accountId: string): PaymentMethodInfo[]

  send(params: {
    accountId: string
    destination: string
    amount: Amount
    memo?: string
    options?: Record<string, unknown>
  }): Promise<Result<SendResult, PaymentError>>

  receive(params: {
    accountId: string
    adapterId: string
    amount: Amount
    description?: string
  }): Promise<Result<ReceiveRequest, PaymentError>>

  redeem(params: {
    adapterId: string
    input: string
  }): Promise<Result<RedeemResult, PaymentError>>

  estimateFee(params: {
    accountId: string
    adapterId: string
    destination: string
    amount: Amount
  }): Promise<Result<FeeEstimate, PaymentError>>

  recoverAll(): Promise<RecoveryReport[]>
}

export interface SendResult {
  transactionId: string
  state: string
  fee?: Amount
  data?: Record<string, unknown>
}

export interface RecoveryReport {
  moduleId: string
  recovered: number
  failed: number
}
