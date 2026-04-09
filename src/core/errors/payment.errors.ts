import type { ErrorCode } from './codes'
import { BaseError } from './base'

/** Plain error shape for Result<T, PaymentError> usage */
export interface PaymentError {
  code: ErrorCode
  message: string
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
