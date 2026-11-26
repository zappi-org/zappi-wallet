import { BaseError } from './base'

export class SwapOutUnavailableError extends BaseError {
  readonly code = 'SWAP_OUT_UNAVAILABLE' as const
  readonly isRetryable = true

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class SwapOutAmountOutOfRangeError extends BaseError {
  readonly code = 'SWAP_OUT_AMOUNT_OUT_OF_RANGE' as const
  readonly isRetryable = false

  constructor(
    message: string,
    public readonly minAmount: number,
    public readonly maxAmount: number,
    cause?: unknown,
  ) {
    super(message, cause)
  }
}

export class SwapOutInvalidDestinationError extends BaseError {
  readonly code = 'SWAP_OUT_INVALID_DESTINATION' as const
  readonly isRetryable = false

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class SwapOutProviderRejectedError extends BaseError {
  readonly code = 'SWAP_OUT_PROVIDER_REJECTED' as const
  readonly isRetryable = true

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class SwapOutQuoteExpiredError extends BaseError {
  readonly code = 'SWAP_OUT_QUOTE_EXPIRED' as const
  readonly isRetryable = false

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class SwapOutOfferUnavailableError extends BaseError {
  readonly code = 'SWAP_OUT_OFFER_UNAVAILABLE' as const
  readonly isRetryable = true

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class SwapOutActiveError extends BaseError {
  readonly code = 'SWAP_OUT_ACTIVE' as const
  readonly isRetryable = false

  constructor(message = 'An on-chain payout is still in progress', cause?: unknown) {
    super(message, cause)
  }
}
