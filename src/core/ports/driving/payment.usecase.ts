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

/** Exposed as a DTO so the UI never references the adapter directly */
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
  }): Promise<Result<RedeemResult, BaseError>>

  inspectInput(params: {
    input: string
    recipientPubkey?: string
  }): Promise<Result<InputInspectionResult, BaseError>>

  /** Finalize a token send once the recipient confirms receipt */
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

  checkAlive(params: {
    requestId: string
    accountId?: string
  }): Promise<boolean>

  queryReceiveStatus(params: {
    requestId: string
    accountId?: string
  }): Promise<Result<{ state: string; isAlive: boolean }, BaseError>>

  claimReceiveRequest(params: {
    requestId: string
    accountId: string
  }): Promise<Result<{ amount: Amount }, BaseError>>

  /**
   * Recover all incomplete payments. By default passes through a single-flight +
   * 30s cooldown gate (prevents overlap across the 6 triggers: unlock, resume,
   * pull-to-refresh, screen entry, etc.). A re-call within the cooldown returns the
   * previous report. Use bypassGate only where "must run now" is intended, such as
   * an explicit user-initiated recovery button.
   */
  recoverAll(opts?: { bypassGate?: boolean }): Promise<RecoveryReport[]>
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
