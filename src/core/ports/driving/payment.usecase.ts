import type { Amount } from '@/core/domain/amount'
import type { Result } from '@/core/domain/result'
import type { PaymentError } from '@/core/errors/payment.errors'
import type {
  FeeEstimate,
  ParsedInput,
  PaymentMethodAdapter,
  ReceiveRequest,
} from '@/core/ports/driven/payment-method.port'
import type { ModuleBalance } from '@/core/ports/driven/wallet-module.port'

export interface PaymentUseCase {
  getAccounts(): Promise<ModuleBalance[]>
  getMethodsForAccount(accountId: string): PaymentMethodAdapter[]

  send(params: {
    accountId: string
    adapterId: string
    destination: string
    amount: Amount
    memo?: string
  }): Promise<Result<SendResult, PaymentError>>

  receive(params: {
    accountId: string
    adapterId: string
    amount: Amount
    description?: string
  }): Promise<Result<ReceiveRequest, PaymentError>>

  estimateFee(params: {
    accountId: string
    adapterId: string
    destination: string
    amount: Amount
  }): Promise<Result<FeeEstimate, PaymentError>>

  parseInput(input: string): ParsedInput | null
  recoverAll(): Promise<RecoveryReport[]>
}

export interface SendResult {
  transactionId: string
  state: string
}

export interface RecoveryReport {
  moduleId: string
  recovered: number
  failed: number
}
