import { BaseError } from './base'
import { formatSats } from '@/utils/format'
import {
  NetworkError as CocoNetworkError,
  MintFetchError,
  MintOperationError,
  ProofOperationError,
  PaymentRequestError,
  HttpResponseError,
  OperationInProgressError,
  UnknownMintError,
  ProofValidationError,
  TokenValidationError,
} from 'coco-cashu-core'
import { LightningRoutingError, LightningPaymentError, InvalidInvoiceError, InvoiceExpiredError } from './lightning'

/**
 * Token has already been spent
 */
export class TokenSpentError extends BaseError {
  readonly code = 'TOKEN_SPENT'
  readonly isRetryable = false

  constructor(message = 'Token has already been spent', cause?: unknown) {
    super(message, cause)
  }

  toUserMessage(): string {
    return '이미 사용된 토큰입니다'
  }
}

/**
 * Insufficient balance for operation
 */
export class InsufficientBalanceError extends BaseError {
  readonly code = 'INSUFFICIENT_BALANCE'
  readonly isRetryable = false

  constructor(
    public readonly required: number,
    public readonly available: number,
    cause?: unknown,
    /** Swap fee that caused the shortfall (0 = pure balance shortage) */
    public readonly fee: number = 0,
  ) {
    super(
      fee > 0
        ? `Insufficient balance for fee: required ${required} + fee ${fee}, available ${available}`
        : `Insufficient balance: required ${required}, available ${available}`,
      cause,
    )
  }

  /** True when balance >= amount but < amount + fee */
  get isFeeShortage(): boolean {
    return this.fee > 0 && this.available >= this.required
  }

  toUserMessage(): string {
    if (this.isFeeShortage) {
      return `수수료 포함 시 잔액이 부족해요 (필요: ${formatSats(this.required)} + 수수료  보유: ${formatSats(this.available)})`
    }
    return `잔액이 부족해요 (필요: ${formatSats(this.required)}  보유: ${formatSats(this.available)})`
  }
}

/**
 * Cannot connect to mint
 */
export class MintConnectionError extends BaseError {
  readonly code = 'MINT_CONNECTION'
  readonly isRetryable = true

  constructor(
    public readonly mintUrl: string,
    cause?: unknown
  ) {
    super(`Cannot connect to mint: ${mintUrl}`, cause)
  }

  toUserMessage(): string {
    return '민트에 연결할 수 없습니다'
  }
}

/**
 * Mint returned an error
 */
export class MintError extends BaseError {
  readonly code = 'MINT_ERROR'
  readonly isRetryable = false

  constructor(
    public readonly mintUrl: string,
    public readonly mintErrorCode?: string,
    message?: string,
    cause?: unknown
  ) {
    super(message || `Mint error from ${mintUrl}: ${mintErrorCode}`, cause)
  }

  toUserMessage(): string {
    return '민트에서 오류가 발생했습니다'
  }
}

/**
 * Invalid token format or signature
 */
export class InvalidTokenError extends BaseError {
  readonly code = 'INVALID_TOKEN'
  readonly isRetryable = false

  constructor(message = 'Invalid token', cause?: unknown) {
    super(message, cause)
  }

  toUserMessage(): string {
    return '유효하지 않은 토큰입니다'
  }
}

/**
 * Invalid proof
 */
export class InvalidProofError extends BaseError {
  readonly code = 'INVALID_PROOF'
  readonly isRetryable = false

  constructor(message = 'Invalid proof', cause?: unknown) {
    super(message, cause)
  }

  toUserMessage(): string {
    return '유효하지 않은 증명입니다'
  }
}

/**
 * Quote not found or expired
 */
export class QuoteNotFoundError extends BaseError {
  readonly code = 'QUOTE_NOT_FOUND'
  readonly isRetryable = false

  constructor(
    public readonly quoteId: string,
    cause?: unknown
  ) {
    super(`Quote not found: ${quoteId}`, cause)
  }

  toUserMessage(): string {
    return '견적을 찾을 수 없습니다'
  }
}

/**
 * Quote expired
 */
export class QuoteExpiredError extends BaseError {
  readonly code = 'QUOTE_EXPIRED'
  readonly isRetryable = false

  constructor(
    public readonly quoteId: string,
    cause?: unknown
  ) {
    super(`Quote expired: ${quoteId}`, cause)
  }

  toUserMessage(): string {
    return '견적이 만료되었습니다'
  }
}

/**
 * P2PK unlock failed
 */
export class P2PKUnlockError extends BaseError {
  readonly code = 'P2PK_UNLOCK_FAILED'
  readonly isRetryable = false

  constructor(message = 'Failed to unlock P2PK token', cause?: unknown) {
    super(message, cause)
  }

  toUserMessage(): string {
    return 'P2PK 토큰 언락에 실패했습니다'
  }
}

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
 */
export function classifyCashuError(error: unknown): BaseError {
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
    if (proofMsg.includes('not enough') || proofMsg.includes('insufficient')) {
      return new InsufficientBalanceError(0, 0, error)
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
    return new InvalidProofError(error.message, error)
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

  if (msg.includes('already spent') || msg.includes('token spent')) {
    return new TokenSpentError(String(error), error)
  }

  if (msg.includes('insufficient') || msg.includes('not enough')) {
    return new InsufficientBalanceError(0, 0, error)
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
