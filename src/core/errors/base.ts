import type { ErrorCode } from './codes'

/**
 * Base error class for all application errors
 */
export abstract class BaseError extends Error {
  abstract readonly code: ErrorCode
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
}

/**
 * Generic network error
 */
export class NetworkError extends BaseError {
  readonly code = 'NETWORK_ERROR' as const
  readonly isRetryable = true
}

/**
 * Timeout error
 */
export class TimeoutError extends BaseError {
  readonly code = 'TIMEOUT' as const
  readonly isRetryable = true
}

/*
* ServiceNotReadyError
*/

export class ServiceNotReadyError extends BaseError {
    readonly code = 'SERVICE_NOT_READY' as const
    readonly isRetryable = true

    constructor(service: string) {
      super(`Service not ready: ${service}`)
    }
}

/**
 * Unknown error wrapper
 */
export class UnknownError extends BaseError {
  readonly code = 'UNKNOWN' as const
  readonly isRetryable = false
}
