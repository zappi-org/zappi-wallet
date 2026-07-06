import type { TFunction } from 'i18next'
import { BaseError } from '@/core/errors/base'
import type { TranslationKey } from '@/i18n'

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
  key: TranslationKey
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
    // UNKNOWN 은 원인 메시지를 감싼 래퍼일 뿐이다 — convention 키(errors.unknown 은
    // 어느 로케일에도 없다)로 보내지 않고 아래 메시지 패턴 매칭으로 폴백해
    // "insufficient/expired/network" 같은 진단 정보를 살린다 (branch 2와 동일한 규칙)
    if (error.code !== 'UNKNOWN') {
      // convention key — runtime-guarded in translateError (missing keys demote to unknownError)
      return { key: `errors.${codeToCamelCase(error.code)}` as TranslationKey }
    }
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

      return { key: `errors.${codeToCamelCase(code)}` as TranslationKey }
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
export function translateError(error: unknown, t: TFunction): string {
  const { key, params } = getErrorI18n(error)
  const translated = t(key, params)
  // convention 키가 로케일에 없으면 i18next 는 키 문자열을 그대로 반환한다 —
  // 사용자에게 리터럴 "errors.xxx" 가 노출되지 않도록 일반 오류 문구로 강등하되,
  // 키 갭 자체는 개발자에게 들리게 남긴다 (무음 삼킴 금지)
  if (translated === key) {
    console.warn('[error-i18n] missing locale key:', key)
    return t('errors.unknownError')
  }
  return translated
}
