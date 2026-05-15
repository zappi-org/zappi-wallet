import type { Amount } from '@/core/domain/amount'
import type { Result } from '@/core/domain/result'
import type { BaseError } from '@/core/errors/base'
import type {
  FeeEstimate,
  ProofIntegrity,
  ReceiveRequest,
  RedeemFeeEstimate,
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
    destination?: string
    amount: Amount
    memo?: string
    options?: Record<string, unknown>
  }): Promise<Result<SendResult, BaseError>>

  receive(params: {
    accountId: string
    protocol?: string
    amount: Amount
    description?: string
  }): Promise<Result<ReceiveRequest, BaseError>>

  redeem(params: {
    input: string
    transactionId?: string
    metadata?: Record<string, unknown>
  }): Promise<Result<RedeemResult, BaseError>>

  inspectInput(params: {
    input: string
    recipientPubkey?: string
  }): Promise<Result<InputInspectionResult, BaseError>>

  /** 토큰 전송 완료 처리 (상대가 수령 확인 후 finalize) */
  completeSend(params: {
    transactionId: string
  }): Promise<Result<{ transactionId: string }, BaseError>>

  reclaim(params: {
    transactionId: string
  }): Promise<Result<ReclaimResult, BaseError>>

  estimateFee(params: {
    accountId: string
    destination: string
    amount: Amount
  }): Promise<Result<FeeEstimate, BaseError>>

  /**
   * estimate fee from input_fee_ppk
   */
  estimateRedeemFee(params: {
    input: string
  }): Promise<Result<RedeemFeeEstimate, BaseError>>

  /**
   * Dry-run quote for reclaiming a pending sent token (tx in 'unclaimed' outcome).
   * Resolves the stored token from transaction metadata and defers to the
   * adapter's redeem-fee estimator (reclaim swap uses the same input_fee_ppk).
   * No side effects — purely read-only.
   */
  quoteReclaim(params: {
    transactionId: string
  }): Promise<Result<RedeemFeeEstimate, BaseError>>

  recoverAll(): Promise<RecoveryReport[]>
  recoverAccounts(params: {
    accountIds: string[]
  }): Promise<AccountRecoveryReport[]>
}

export interface SendResult {
  transactionId: string
  state: string
  fee?: Amount
  data?: Record<string, unknown>
}

export interface ReclaimResult {
  transactionId: string
  amount: Amount
  /**
   * Resolution of the reclaim attempt:
   * - 'reclaimed' — cancel/rollback succeeded, proofs returned to wallet
   * - 'already_consumed' — recipient already claimed the token; tx was
   *   reconciled to settled+claimed instead of failing
   */
  state?: 'reclaimed' | 'already_consumed'
}

export interface RecoveryReport {
  moduleId: string
  recovered: number
  failed: number
}

export interface AccountRecoveryReport {
  moduleId: string
  accountId: string
  success: boolean
  error?: string
}

export interface InputInspectionResult {
  lockStatus: 'locked-to-recipient' | 'locked-to-other' | 'unlocked' | 'not-supported'
  proofIntegrity: ProofIntegrity
}
