import { BaseError } from './base'

/**
 * Token has already been spent
 */
export class TokenSpentError extends BaseError {
  readonly code = 'TOKEN_SPENT' as const
  readonly isRetryable = false

  constructor(message = 'Token has already been spent', cause?: unknown) {
    super(message, cause)
  }
}

/**
 * Cannot connect to mint
 */
export class MintConnectionError extends BaseError {
  readonly code = 'MINT_CONNECTION' as const
  readonly isRetryable = true

  constructor(
    public readonly mintUrl: string,
    cause?: unknown
  ) {
    super(`Cannot connect to mint: ${mintUrl}`, cause)
  }
}

/**
 * Mint returned an error
 */
export class MintError extends BaseError {
  readonly code = 'MINT_ERROR' as const
  readonly isRetryable = false

  constructor(
    public readonly mintUrl: string,
    public readonly mintErrorCode?: string,
    message?: string,
    cause?: unknown
  ) {
    super(message || `Mint error from ${mintUrl}: ${mintErrorCode}`, cause)
  }
}

/**
 * Invalid token format or signature
 */
export class InvalidTokenError extends BaseError {
  readonly code = 'INVALID_TOKEN' as const
  readonly isRetryable = false

  constructor(message = 'Invalid token', cause?: unknown) {
    super(message, cause)
  }
}

/**
 * Invalid proof
 */
export class InvalidProofError extends BaseError {
  readonly code = 'INVALID_PROOF' as const
  readonly isRetryable = false

  constructor(message = 'Invalid proof', cause?: unknown) {
    super(message, cause)
  }
}

/**
 * Quote not found or expired
 */
export class QuoteNotFoundError extends BaseError {
  readonly code = 'QUOTE_NOT_FOUND' as const
  readonly isRetryable = false

  constructor(
    public readonly quoteId: string,
    cause?: unknown
  ) {
    super(`Quote not found: ${quoteId}`, cause)
  }
}

/**
 * Quote expired
 */
export class QuoteExpiredError extends BaseError {
  readonly code = 'QUOTE_EXPIRED' as const
  readonly isRetryable = false

  constructor(
    public readonly quoteId: string,
    cause?: unknown
  ) {
    super(`Quote expired: ${quoteId}`, cause)
  }
}

/**
 * P2PK unlock failed
 */
export class P2PKUnlockError extends BaseError {
  readonly code = 'P2PK_UNLOCK_FAILED' as const
  readonly isRetryable = false

  constructor(message = 'Failed to unlock P2PK token', cause?: unknown) {
    super(message, cause)
  }
}

