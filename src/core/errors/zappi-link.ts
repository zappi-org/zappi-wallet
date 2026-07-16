import { BaseError } from './base'

/**
 * Lightning Address registration failed
 */
export class ZappiLinkRegistrationError extends BaseError {
  readonly code = 'ZAPPI_LINK_REGISTRATION_FAILED' as const
  readonly isRetryable = true

  constructor(message = 'Failed to register Lightning Address', cause?: unknown) {
    super(message, cause)
  }
}

/**
 * Address not found (404)
 */
export class ZappiLinkNotFoundError extends BaseError {
  readonly code = 'ZAPPI_LINK_NOT_FOUND' as const
  readonly isRetryable = false

  constructor(cause?: unknown) {
    super('No Lightning Address found for this account', cause)
  }
}

/**
 * Generic zappi-link API error
 */
export class ZappiLinkApiError extends BaseError {
  readonly code = 'ZAPPI_LINK_API_ERROR' as const
  readonly isRetryable = true

  constructor(
    public readonly statusCode: number,
    message = 'Zappi Link API error',
    cause?: unknown
  ) {
    super(`${message} (HTTP ${statusCode})`, cause)
  }
}
