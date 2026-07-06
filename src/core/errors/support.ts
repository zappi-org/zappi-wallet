import { BaseError } from './base'

/**
 * 종결(terminal) 상태의 문의 티켓에 메시지를 보내려 했다.
 */
export class SupportTicketResolvedError extends BaseError {
  readonly code = 'SUPPORT_TICKET_RESOLVED' as const
  readonly isRetryable = false

  constructor(message = 'Support ticket is already resolved', cause?: unknown) {
    super(message, cause)
  }
}
