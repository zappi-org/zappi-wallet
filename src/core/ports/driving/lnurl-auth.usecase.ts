/**
 * LnurlAuthUseCase — LNURL-auth driving port
 */

import type { Result } from '@/core/domain/result'
import type { PaymentError } from '@/core/errors/payment.errors'

export interface AuthRequest {
  /** 인증 대상 도메인 */
  domain: string
  /** 서비스 요청 액션 */
  action?: string
}

export interface AuthResult {
  success: boolean
  domain: string
}

export interface LnurlAuthUseCase {
  /** LNURL-auth URL 파싱 → 인증 요청 정보 */
  parseAuthUrl(url: string): Promise<Result<AuthRequest, PaymentError>>
  /** 인증 실행 (도메인별 키 파생 → challenge 서명 → HTTP POST) */
  confirmAuth(url: string): Promise<Result<AuthResult, PaymentError>>
}
