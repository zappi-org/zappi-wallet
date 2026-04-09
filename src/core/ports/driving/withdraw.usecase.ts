/**
 * WithdrawUseCase — LNURL-withdraw driving port
 */

import type { Amount } from '@/core/domain/amount'
import type { Result } from '@/core/domain/result'
import type { PaymentError } from '@/core/errors/payment.errors'

export interface WithdrawParams {
  /** LNURL-withdraw URL */
  url: string
}

export interface WithdrawInfo {
  /** 서비스 도메인 */
  domain: string
  /** 최소 출금액 (sats) */
  minSats: number
  /** 최대 출금액 (sats) */
  maxSats: number
  /** 설명 */
  description: string
}

export interface WithdrawResult {
  amount: Amount
  completedAt: number
}

export interface WithdrawUseCase {
  /** LNURL-withdraw URL 파싱 → 출금 정보 */
  parseWithdrawUrl(url: string): Promise<Result<WithdrawInfo, PaymentError>>
  /** 출금 실행 (mint에서 invoice 생성 → 서비스가 결제) */
  executeWithdraw(params: {
    url: string
    amountSats: number
    accountId: string
  }): Promise<Result<WithdrawResult, PaymentError>>
}
