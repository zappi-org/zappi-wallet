import { BaseError } from './base'
/**
 * Reclaim 도메인 특화 에러들
 * TokenSpentError 등의 저수준 에러를 reclaim 컨텍스트에서 해석한 결과
 */
export class TokenSpentByRecipientError extends BaseError {
  readonly code = 'TOKEN_SPENT_BY_RECIPIENT' as const
  readonly isRetryable = false
  constructor(message = 'Token has already been claimed by recipient') {
    super(message)
  }
}
