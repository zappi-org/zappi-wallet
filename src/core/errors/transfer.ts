import { BaseError } from './base'

/**
 * No PendingTransfer exists, or its state does not allow the requested action
 * (claim/reclaim/complete). Not resolvable by user retry.
 */
export class TransferStateError extends BaseError {
  readonly code = 'TRANSFER_STATE_INVALID' as const
  readonly isRetryable = false

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}
