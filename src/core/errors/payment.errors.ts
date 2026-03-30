import { BaseError } from './base'

export type PaymentErrorCode =
  | 'INSUFFICIENT_BALANCE'
  | 'MINT_UNREACHABLE'
  | 'QUOTE_EXPIRED'
  | 'MODULE_NOT_FOUND'
  | 'ADAPTER_NOT_FOUND'
  | 'INVALID_DESTINATION'
  | 'AMOUNT_TOO_SMALL'
  | 'AMOUNT_TOO_LARGE'
  | 'NFC_UNAVAILABLE'
  | 'NFC_WRITE_FAILED'
  | 'SWAP_FAILED'
  | 'UNKNOWN'

/** Plain error shape for Result<T, PaymentError> usage */
export interface PaymentError {
  code: PaymentErrorCode
  message: string
}

/** Class-based error for throw/catch boundaries (SDK → Module internal) */
export class InsufficientBalanceError extends BaseError {
  readonly code = 'INSUFFICIENT_BALANCE'
  readonly isRetryable = false

  toUserMessage(): string {
    return 'INSUFFICIENT_BALANCE'
  }
}

export class MintUnreachableError extends BaseError {
  readonly code = 'MINT_UNREACHABLE'
  readonly isRetryable = true

  toUserMessage(): string {
    return 'MINT_UNREACHABLE'
  }
}

export class QuoteExpiredError extends BaseError {
  readonly code = 'QUOTE_EXPIRED'
  readonly isRetryable = true

  toUserMessage(): string {
    return 'QUOTE_EXPIRED'
  }
}

export class InvalidDestinationError extends BaseError {
  readonly code = 'INVALID_DESTINATION'
  readonly isRetryable = false

  toUserMessage(): string {
    return 'INVALID_DESTINATION'
  }
}
