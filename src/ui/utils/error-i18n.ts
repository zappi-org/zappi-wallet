import { BaseError } from '@/core/errors/base'

/**
 * Error → i18n key + params resolver
 *
 * BaseError (code 보유) → convention 기반 i18n 키 변환 + 파라미터 추출
 * Raw error (code 없음) → 메시지 패턴 매칭 fallback
 *
 * Convention: ERROR_CODE → errors.errorCode (camelCase)
 * 예: TOKEN_SPENT → errors.tokenSpent
 */

export interface ErrorI18n {
  key: string
  params?: Record<string, unknown>
}

function codeToCamelCase(code: string): string {
  return code.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/**
 * 에러 객체에서 i18n 키 + 보간 파라미터를 반환.
 * t(result.key, result.params) 으로 사용.
 */
export function getErrorI18n(error: unknown): ErrorI18n {
  // 1. BaseError 인스턴스 체크 (도메인 에러)
  if (error instanceof BaseError) {
    const override = resolveOverride(error)
    if (override) return override
    return { key: `errors.${codeToCamelCase(error.code)}` }
  }

  // 2. code 속성이 있는 객체 체크 (SDK 에러, Result 에러 등)
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>
    const code = err.code

    // Direct TokenSpentError check (instance 가 아닌 plain object)
    if (code === 'TOKEN_SPENT') {
      return { key: 'errors.tokenSpent' }
    }

    if (typeof code === 'string' && code !== 'UNKNOWN') {
      // 에러별 키/파라미터 오버라이드 우선
      const override = resolveOverride(err)
      if (override) return override

      return { key: `errors.${codeToCamelCase(code)}` }
    }
  }

  // 3. String pattern matching fallback (raw SDK errors)
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()

  if (
    msg.includes('receive amount is not sufficient after fees') ||
    (msg.includes('after fees') && (msg.includes('not sufficient') || msg.includes('insufficient') || msg.includes('not enough')))
  ) {
    return { key: 'receive.tokenReceiveFeeTooHigh' }
  }
  if (msg.includes('not enough proofs') || msg.includes('insufficient')) return { key: 'errors.insufficientBalance', params: { required: '?', available: '?' } }
  if (msg.includes('already spent') || msg.includes('token spent') || msg.includes('proof spent')) return { key: 'errors.tokenSpent' }
  if (msg.includes('timeout') || msg.includes('timed out')) return { key: 'errors.timeoutError' }
  if (msg.includes('expired')) return { key: 'errors.quoteExpired' }
  if (msg.includes('not trusted') || msg.includes('unknown mint')) return { key: 'errors.mintConnection', params: { mint: '' } }
  if (msg.includes('network') || msg.includes('econnrefused') || msg.includes('fetch')) return { key: 'errors.networkError' }
  if (msg.includes('invalid token') || msg.includes('invalid proof')) return { key: 'errors.invalidToken' }
  if (msg.includes('routing') || msg.includes('no_route')) return { key: 'errors.lightningRouting' }

  return { key: 'errors.unknownError' }
}

/**
 * BaseError 서브클래스에서 i18n 키 오버라이드 + 보간용 파라미터 추출.
 * 에러 코드별로 더 적절한 키나 파라미터를 반환.
 */
function resolveOverride(err: Record<string, unknown> | BaseError): ErrorI18n | undefined {
  const code = err.code as string

  if (code === 'INSUFFICIENT_BALANCE') {
    const obj = err as Record<string, unknown>
    const required = obj.required as number | undefined
    const available = obj.available as number | undefined
    const fee = obj.fee as number | undefined

    // 금액 정보 없으면 단순 메시지
    if (!required && !available) {
      return { key: 'payment.insufficientBalance' }
    }

    // fee 있으면 수수료 포함 메시지
    if (fee && fee > 0) {
      return { key: 'errors.insufficientBalanceForFee', params: { required, available } }
    }

    return { key: 'errors.insufficientBalance', params: { required, available } }
  }

  if (code === 'MINT_CONNECTION' || code === 'MINT_UNREACHABLE') {
    const obj = err as Record<string, unknown>
    return { key: 'errors.mintConnection', params: { mint: (obj.mintUrl as string) ?? '' } }
  }

  if (code === 'REDEEM_FEE_TOO_HIGH') {
    return { key: 'receive.tokenReceiveFeeTooHigh' }
  }

  return undefined
}

/**
 * t 함수와 조합하여 번역된 에러 메시지를 즉시 반환.
 * 사용: translateError(err, t)
 */
export function translateError(error: unknown, t: (key: string, params?: Record<string, unknown>) => string): string {
  const { key, params } = getErrorI18n(error)
  return t(key, params)
}
