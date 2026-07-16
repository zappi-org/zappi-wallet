import { BaseError } from './base'

/**
 * Raised when sending a message to a support ticket that is already in a terminal (resolved) state.
 */
export class SupportTicketResolvedError extends BaseError {
  readonly code = 'SUPPORT_TICKET_RESOLVED' as const
  readonly isRetryable = false

  constructor(message = 'Support ticket is already resolved', cause?: unknown) {
    super(message, cause)
  }
}
