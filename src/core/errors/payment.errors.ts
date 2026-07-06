import type { ErrorCode } from './codes'
import { BaseError } from './base'

/**
 * Module not found for operation
 */
export class ModuleNotFoundError extends BaseError {
  readonly code = 'MODULE_NOT_FOUND' as const
  readonly isRetryable = false

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

/**
 * Adapter not found for operation
 */
export class AdapterNotFoundError extends BaseError {
  readonly code = 'ADAPTER_NOT_FOUND' as const
  readonly isRetryable = false

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

/**
 * Destination address is not in any recognized format
 */
export class InvalidDestinationError extends BaseError {
  readonly code = 'INVALID_DESTINATION' as const
  readonly isRetryable = false

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

/**
 * Raw input (QR/paste) could not be classified into any known type
 */
export class UnrecognizedInputError extends BaseError {
  readonly code = 'UNRECOGNIZED_INPUT' as const
  readonly isRetryable = false

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

/**
 * ReceiveRequest construction/lookup received invalid parameters
 */
export class ReceiveRequestInvalidError extends BaseError {
  readonly code = 'RECEIVE_REQUEST_INVALID' as const
  readonly isRetryable = false

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

/**
 * Plain error shape for Result<T, PaymentError> usage
 * @deprecated Use BaseError subclasses instead
 */
export interface PaymentError {
  code: ErrorCode
  message: string
  isRetryable?: boolean
}

/**
 * Insufficient balance for operation
 */
export class InsufficientBalanceError extends BaseError {
  readonly code = 'INSUFFICIENT_BALANCE' as const
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
}

/**
 * Token receive amount is fully consumed by mint receive fees.
 */
export class RedeemFeeTooHighError extends BaseError {
  readonly code = 'REDEEM_FEE_TOO_HIGH' as const
  readonly isRetryable = false

  constructor(message = 'Receive amount is not sufficient after fees', cause?: unknown) {
    super(message, cause)
  }
}
