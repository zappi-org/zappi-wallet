import { BaseError } from './base'

export class NpubcashAuthError extends BaseError {
  readonly code = 'NPUBCASH_AUTH_FAILED' as const
  readonly isRetryable = true

  constructor(message = 'Authentication failed', cause?: unknown) {
    super(message, cause)
  }
}

export class NpubcashApiError extends BaseError {
  readonly code = 'NPUBCASH_API_ERROR' as const
  readonly isRetryable = true

  constructor(
    public readonly statusCode: number,
    message = 'Server error',
    cause?: unknown,
  ) {
    super(`${message} (HTTP ${statusCode})`, cause)
  }
}

export class NpubcashUsernameTakenError extends BaseError {
  readonly code = 'NPUBCASH_USERNAME_TAKEN' as const
  readonly isRetryable = false

  constructor(message = 'Username is already taken', cause?: unknown) {
    super(message, cause)
  }
}

export class NpubcashPaymentRequiredError extends BaseError {
  readonly code = 'NPUBCASH_PAYMENT_REQUIRED' as const
  readonly isRetryable = true

  constructor(
    public readonly encodedRequest: string,
    message = 'Payment required',
    cause?: unknown,
  ) {
    super(message, cause)
  }
}
