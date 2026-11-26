import { BaseError } from './base'

export class OnchainPayoutUnavailableError extends BaseError {
  readonly code = 'ONCHAIN_PAYOUT_UNAVAILABLE' as const
  readonly isRetryable = true

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class OnchainPayoutAmountOutOfRangeError extends BaseError {
  readonly code = 'ONCHAIN_PAYOUT_AMOUNT_OUT_OF_RANGE' as const
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

export class OnchainPayoutInvalidDestinationError extends BaseError {
  readonly code = 'ONCHAIN_PAYOUT_INVALID_DESTINATION' as const
  readonly isRetryable = false

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class OnchainPayoutProviderRejectedError extends BaseError {
  readonly code = 'ONCHAIN_PAYOUT_PROVIDER_REJECTED' as const
  readonly isRetryable = true

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class OnchainPayoutQuoteExpiredError extends BaseError {
  readonly code = 'ONCHAIN_PAYOUT_QUOTE_EXPIRED' as const
  readonly isRetryable = false

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class OnchainPayoutOfferUnavailableError extends BaseError {
  readonly code = 'ONCHAIN_PAYOUT_OFFER_UNAVAILABLE' as const
  readonly isRetryable = true

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}

export class OnchainPayoutActiveError extends BaseError {
  readonly code = 'ONCHAIN_PAYOUT_ACTIVE' as const
  readonly isRetryable = false

  constructor(message = 'An on-chain payout is still in progress', cause?: unknown) {
    super(message, cause)
  }
}
