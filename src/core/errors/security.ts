import { BaseError } from './base'

/**
 * Security error codes
 */
export type SecurityErrorCode =
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

  toUserMessage(): string {
    switch (this.code) {
      case 'INVALID_MNEMONIC':
        return '유효하지 않은 복구 문구입니다'
      case 'INVALID_PASSWORD':
        return '비밀번호가 올바르지 않습니다'
      case 'NO_WALLET':
        return '지갑을 찾을 수 없습니다'
      case 'CREATE_WALLET_FAILED':
        return '지갑 생성에 실패했습니다'
      case 'UNLOCK_FAILED':
        return '잠금 해제에 실패했습니다'
      case 'CHANGE_PASSWORD_FAILED':
        return '비밀번호 변경에 실패했습니다'
      case 'GET_MNEMONIC_FAILED':
        return '복구 문구를 가져올 수 없습니다'
      case 'VERIFY_FAILED':
        return '인증에 실패했습니다'
      case 'ENCRYPTION_FAILED':
        return '암호화에 실패했습니다'
      case 'DECRYPTION_FAILED':
        return '복호화에 실패했습니다'
      default:
        return '보안 오류가 발생했습니다'
    }
  }
}
