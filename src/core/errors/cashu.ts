import { BaseError } from './base'
import { formatSats } from '@/utils/format'

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
 * Classify Cashu error from raw error
 */
export function classifyCashuError(error: unknown): BaseError {
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
