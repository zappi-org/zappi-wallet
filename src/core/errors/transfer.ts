import { BaseError } from './base'

/**
 * PendingTransfer가 없거나, 요청된 동작(claim/reclaim/complete)을
 * 허용하지 않는 상태다. 사용자 재시도로 해소되지 않는다.
 */
export class TransferStateError extends BaseError {
  readonly code = 'TRANSFER_STATE_INVALID' as const
  readonly isRetryable = false

  constructor(message: string, cause?: unknown) {
    super(message, cause)
  }
}
