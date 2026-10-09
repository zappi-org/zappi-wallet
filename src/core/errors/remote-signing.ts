import { BaseError } from './base'
import type { ErrorCode } from './codes'

/**
 * Remote signing (NIP-46) error codes.
 */
export type RemoteSigningErrorCode = Extract<ErrorCode,
  | 'SIGNER_SECRET_REUSED'
  | 'SIGNER_TRANSPORT_FAILED'
>

export class RemoteSigningError extends BaseError {
  readonly isRetryable = false

  constructor(
    readonly code: RemoteSigningErrorCode,
    message: string,
    cause?: unknown
  ) {
    super(message, cause)
  }
}
