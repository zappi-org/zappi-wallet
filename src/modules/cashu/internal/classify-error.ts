/**
 * SDK 에러 → 도메인 에러 변환기
 *
 * @cashu/coco-core SDK 에러 타입을 instanceof로 분류하여
 * core 도메인 에러로 변환한다. core가 SDK를 몰라야 하므로
 * 이 함수는 모듈 레이어에 위치한다.
 */
import { BaseError } from '@/core/errors/base'
import {
  InvalidProofError,
  InvalidTokenError,
  KeysetSyncError,
  MintConnectionError,
  MintError,
  QuoteExpiredError,
  QuoteNotFoundError,
  TokenSpentError,
} from '@/core/errors/cashu'
import {
  InvalidInvoiceError,
  InvoiceExpiredError,
  LightningPaymentError,
  LightningRoutingError,
} from '@/core/errors/lightning'
import { InsufficientBalanceError, RedeemFeeTooHighError } from '@/core/errors/payment.errors'
import {
  KeysetSyncError as CocoKeysetSyncError,
  NetworkError as CocoNetworkError,
  HttpResponseError,
  MintFetchError,
  MintOperationError,
  OperationInProgressError,
  PaymentRequestError,
  ProofOperationError,
  ProofValidationError,
  TokenValidationError,
  UnknownMintError,
} from '@cashu/coco-core'
import { cocoLogger as logger } from './logger'

/**
 * Classify MintOperationError by NUT-00 code and detail message
 */
function classifyMintOperationError(error: MintOperationError): BaseError {
  const { code, message } = error
  const detail = message.toLowerCase()

  // ── Code-based classification (cdk-mintd v0.15 기준) ──

  // 10xxx: proof verification
  if (code === 10001) return new InvalidProofError(message, error)

  // 11xxx: input/output errors
  if (code === 11001) return new TokenSpentError(message, error)
  if (code === 11002) return new TokenSpentError(message, error) // token pending → spent 취급
  if (code === 11005) return new InsufficientBalanceError(0, 0, error)

  // 20xxx: quote/payment errors
  if (code === 20002) return new MintError('unknown', String(code), message, error) // already issued
  if (code === 20004) {
    // cdk는 모든 Lightning 에러를 20004로 통합 — detail로 routing 구분
    if (/\brouting\b|\broute\b|\bno_route\b/.test(detail)) {
      return new LightningRoutingError(message, error)
    }
    return new LightningPaymentError(message, error)
  }
  if (code === 20007) return new QuoteExpiredError(message, error)

  // ── Detail-based fallback (mint 구현체별 차이 대비) ──

  // Lightning routing/payment (non-20004 code에서도 detail 기반 매칭)
  if (/\brouting\b|\broute\b|\bno_route\b/.test(detail)) {
    return new LightningRoutingError(message, error)
  }
  if (/\bpayment\b/.test(detail) && /\b(?:fail|error)/.test(detail)) {
    return new LightningPaymentError(message, error)
  }
  if (/\binvoice\b/.test(detail) && /\bexpir/.test(detail)) {
    return new InvoiceExpiredError(message, error)
  }

  // Token spent
  if (detail.includes('already spent') || detail.includes('token spent')) {
    return new TokenSpentError(message, error)
  }

  if (isRedeemFeeTooHighMessage(detail)) {
    return new RedeemFeeTooHighError(message, error)
  }

  // Insufficient balance
  if (detail.includes('insufficient') || detail.includes('not enough')) {
    return new InsufficientBalanceError(0, 0, error)
  }

  // Quote not found (cdk는 50000 catch-all로 보냄)
  if (detail.includes('unknown quote') || detail.includes('quote not found')) {
    return new QuoteNotFoundError(message, error)
  }

  // Invalid proof/token
  if (detail.includes('invalid proof') || detail.includes('invalid token') || detail.includes('not verified') || detail.includes('could not verify')) {
    return new InvalidProofError(message, error)
  }

  // Default: preserve code for debugging
  return new MintError('unknown', String(code), message, error)
}

/**
 * Classify Cashu error from raw error
 *
 * Phase 1: Coco SDK 타입드 에러 (instanceof)
 * Phase 2: 문자열 폴백 (cashu-ts 등 non-Coco 에러용)
 *
 * `ctx` carries what the classifier cannot know but the domain error needs: the
 * amount we tried to move and the mint's spendable balance. Without it
 * `InsufficientBalanceError` degrades to (0, 0) and `FundingRequiredError`
 * downstream can only ask for 0 sat.
 */
export function classifyCashuError(
  error: unknown,
  ctx?: InsufficientFundsContext,
): BaseError {
  if (error instanceof BaseError) {
    return error
  }

  // Phase 1: Coco SDK typed errors
  if (error instanceof CocoNetworkError) {
    return new MintConnectionError('unknown', error)
  }

  if (error instanceof MintFetchError) {
    return new MintConnectionError(error.mintUrl, error)
  }

  if (error instanceof UnknownMintError) {
    return new MintConnectionError('unknown', error)
  }

  if (error instanceof ProofOperationError) {
    const proofMsg = error.message.toLowerCase()
    if (isRedeemFeeTooHighMessage(proofMsg)) {
      return new RedeemFeeTooHighError(error.message, error)
    }
    if (isInsufficientFundsMessage(proofMsg)) {
      return insufficientBalance(ctx, error)
    }
    return new InvalidProofError(error.message, error)
  }

  if (error instanceof PaymentRequestError) {
    return new InvalidInvoiceError(error.message, error)
  }

  if (error instanceof OperationInProgressError) {
    return new MintError('unknown', undefined, `Operation already in progress: ${error.operationId}`, error)
  }

  if (error instanceof TokenValidationError) {
    return new InvalidTokenError(error.message, error)
  }

  if (error instanceof ProofValidationError) {
    const proofMsg = error.message.toLowerCase()
    if(isRedeemFeeTooHighMessage(proofMsg)) {
      return new RedeemFeeTooHighError(error.message, error)
    }
    // coco throws this for "Not enough proofs to send" — a funds problem, not a
    // malformed proof. Callers key their funding UI off InsufficientBalanceError.
    if (isInsufficientFundsMessage(proofMsg)) {
      return insufficientBalance(ctx, error)
    }
    return new InvalidProofError(error.message, error)
  }

  if (error instanceof CocoKeysetSyncError) {
    return new KeysetSyncError(error.mintUrl, error.keysetId, error)
  }

  if (error instanceof MintOperationError) {
    return classifyMintOperationError(error)
  }

  if (error instanceof HttpResponseError) {
    if (error.status >= 500) {
      return new MintConnectionError('unknown', error)
    }
    return new MintError('unknown', String(error.status), error.message, error)
  }

  // Phase 2: String fallback (cashu-ts, plain Error, etc.)
  const msg = String(error).toLowerCase()

  if (isRedeemFeeTooHighMessage(msg)) {
    return new RedeemFeeTooHighError(String(error), error)
  }

  // Keyset short-ID mapping failure (SDK throws plain Error)
  const keysetMatch = msg.match(/(?:couldn't map short keyset id|short keyset id)\s+([a-f0-9]+)/i)
  if (keysetMatch) {
    logger.info('[classifyCashuError] keyset id missing:', keysetMatch[1])
    return new KeysetSyncError('unknown', keysetMatch[1], error)
  }

  if (msg.includes('already spent') || msg.includes('token spent')) {
    return new TokenSpentError(String(error), error)
  }

  if (msg.includes('insufficient') || msg.includes('not enough')) {
    return insufficientBalance(ctx, error)
  }

  if (msg.includes('timeout') || msg.includes('timed out')) {
    return new MintConnectionError('unknown', error)
  }

  if (msg.includes('not trusted') || msg.includes('unknown mint')) {
    return new MintConnectionError('unknown', error)
  }

  if (msg.includes('connect') || msg.includes('network') || msg.includes('fetch')) {
    return new MintConnectionError('unknown', error)
  }

  if (msg.includes('invalid token') || msg.includes('invalid proof')) {
    return new InvalidTokenError(String(error), error)
  }

  if (msg.includes('quote not found') || msg.includes('quote expired')) {
    return new QuoteNotFoundError('unknown', error)
  }

  return new MintError('unknown', undefined, String(error), error)
}

function isRedeemFeeTooHighMessage(message: string): boolean {
  return (
    message.includes('receive amount is not sufficient after fees') ||
    (
      message.includes('after fees') &&
      (message.includes('not sufficient') || message.includes('insufficient') || message.includes('not enough'))
    )
  )
}

/** Amount we tried to move + the mint's spendable balance, when the caller knows them. */
export interface InsufficientFundsContext {
  amount?: number
  available?: number
}

/**
 * coco says "Not enough proofs to send" (ProofValidationError); cashu-ts says
 * "Not enough funds". Both are funds problems, never proof corruption.
 */
export function isInsufficientFundsMessage(message: string): boolean {
  const msg = message.toLowerCase()
  if (isRedeemFeeTooHighMessage(msg)) return false
  return /\b(?:not enough|insufficient)\b/.test(msg)
}

/**
 * A send needs `amount` plus the swap fee, so `available >= amount` but still
 * failing means the gap is the fee (coco does not report it).
 */
function insufficientBalance(
  ctx: InsufficientFundsContext | undefined,
  cause: unknown,
): InsufficientBalanceError {
  if (!ctx) return new InsufficientBalanceError(0, 0, cause)
  const amount = ctx.amount ?? 0
  const available = ctx.available ?? 0
  return new InsufficientBalanceError(amount, available, cause, available >= amount ? 1 : 0)
}
