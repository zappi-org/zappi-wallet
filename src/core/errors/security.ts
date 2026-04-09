import { BaseError } from './base'
import type { ErrorCode } from './codes'

/**
 * Security error codes
 */
export type SecurityErrorCode = Extract<ErrorCode,
  | 'INVALID_MNEMONIC'
  | 'INVALID_PASSWORD'
  | 'NO_WALLET'
  | 'CREATE_WALLET_FAILED'
  | 'UNLOCK_FAILED'
  | 'CHANGE_PASSWORD_FAILED'
  | 'GET_MNEMONIC_FAILED'
  | 'VERIFY_FAILED'
  | 'ENCRYPTION_FAILED'
  | 'DECRYPTION_FAILED'
>

/**
 * Security-related error
 */
export class SecurityError extends BaseError {
  readonly isRetryable = false

  constructor(
    readonly code: SecurityErrorCode,
    message: string,
    cause?: unknown
  ) {
    super(message, cause)
  }
}
