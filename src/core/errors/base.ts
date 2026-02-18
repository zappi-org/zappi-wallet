/**
 * Base error class for all application errors
 */
export abstract class BaseError extends Error {
  abstract readonly code: string
  abstract readonly isRetryable: boolean

  constructor(message: string, public readonly cause?: unknown) {
    super(message)
    this.name = this.constructor.name

    // Maintains proper stack trace for where error was thrown (V8 engines)
    const ErrorWithStackTrace = Error as typeof Error & {
      captureStackTrace?: (target: object, constructorOpt?: (...args: unknown[]) => unknown) => void
    }
    if (ErrorWithStackTrace.captureStackTrace) {
      ErrorWithStackTrace.captureStackTrace(this, this.constructor as (...args: unknown[]) => unknown)
    }
  }

  /**
   * Convert to a user-friendly message
   */
  abstract toUserMessage(): string
}

/**
 * Generic network error
 */
export class NetworkError extends BaseError {
  readonly code = 'NETWORK_ERROR'
  readonly isRetryable = true

  toUserMessage(): string {
    return '네트워크 오류가 발생했습니다'
  }
}

/**
 * Timeout error
 */
export class TimeoutError extends BaseError {
  readonly code = 'TIMEOUT'
  readonly isRetryable = true

  toUserMessage(): string {
    return '요청 시간이 초과되었습니다'
  }
}

/**
 * Unknown error wrapper
 */
export class UnknownError extends BaseError {
  readonly code = 'UNKNOWN'
  readonly isRetryable = false

  toUserMessage(): string {
    return '알 수 없는 오류가 발생했습니다'
  }
}
