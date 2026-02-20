import { BaseError } from './base'

/**
 * Lightning Address registration failed
 */
export class ZappiLinkRegistrationError extends BaseError {
  readonly code = 'ZAPPI_LINK_REGISTRATION_FAILED'
  readonly isRetryable = true

  constructor(message = 'Failed to register Lightning Address', cause?: unknown) {
    super(message, cause)
  }

  toUserMessage(): string {
    return 'Lightning Address 등록에 실패했습니다'
  }
}

/**
 * Address not found (404)
 */
export class ZappiLinkNotFoundError extends BaseError {
  readonly code = 'ZAPPI_LINK_NOT_FOUND'
  readonly isRetryable = false

  constructor(cause?: unknown) {
    super('No Lightning Address found for this account', cause)
  }

  toUserMessage(): string {
    return 'Lightning Address를 찾을 수 없습니다'
  }
}

/**
 * Generic zappi-link API error
 */
export class ZappiLinkApiError extends BaseError {
  readonly code = 'ZAPPI_LINK_API_ERROR'
  readonly isRetryable = true

  constructor(
    public readonly statusCode: number,
    message = 'Zappi Link API error',
    cause?: unknown
  ) {
    super(`${message} (HTTP ${statusCode})`, cause)
  }

  toUserMessage(): string {
    return 'Zappi Link 서비스에 연결할 수 없습니다'
  }
}
