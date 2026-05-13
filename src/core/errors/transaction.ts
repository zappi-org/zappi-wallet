import { BaseError } from "./base";


/**
 * TranscationNotFoundError
 *
 */
export class TranscationNotFoundError extends BaseError {
  readonly code = 'TRANSACTION_NOT_FOUND' as const

  readonly isRetryable = false

  constructor(txId: string) {
    super(`Transaction not found: ${txId}`)
  }
}
