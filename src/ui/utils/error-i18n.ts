import type { TFunction } from 'i18next'
import { BaseError } from '@/core/errors/base'
import type { TranslationKey } from '@/i18n'
import { formatSats } from '@/utils/format'

/**
 * Error → i18n key + params resolver
 *
 * BaseError (code 보유) → convention 기반 i18n 키 변환 + 파라미터 추출
 * Raw error (code 없음) → 메시지 패턴 매칭 fallback
 *
 * Convention: ERROR_CODE → errors.errorCode (camelCase)
 * 예: TOKEN_SPENT → errors.tokenSpent
 *
 * R2-C: 구 error-message.ts(toErrorMessage) 를 여기로 단일화 — 시맨틱 실차이
 * 3건은 풍부한 쪽을 흡수했다: ① MINT_CONNECTION 민트명 해석(alias→hostname→원문)
 * ② INSUFFICIENT_BALANCE 금액의 formatSats 포맷 ③ 수수료 문구 분기를 도메인
 * getter isFeeShortage 시맨틱(fee>0 && available>=required)으로.
 */

export interface ErrorI18n {
  key: TranslationKey
  params?: Record<string, unknown>
}

function codeToCamelCase(code: string): string {
  return code.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** 민트 표시명 해석기 — MainApp 이 mintAliases 조회를 등록한다 (구 error-message.ts 이전) */
let mintNameResolver: ((mintUrl: string) => string | null) | null = null

export function setMintNameResolver(resolver: (mintUrl: string) => string | null): void {
  mintNameResolver = resolver
}

/** alias → hostname → 원문 URL 순으로 민트 표시명 결정 (구 toErrorMessage 시맨틱) */
function resolveMintDisplayName(mintUrl: string): string {
  let mintName = mintUrl
  try {
    mintName = new URL(mintUrl).hostname
  } catch { /* fallback to url */ }
  if (mintNameResolver) {
    mintName = mintNameResolver(mintUrl) || mintName
  }
  return mintName
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

    // 금액은 formatSats(단위 설정 반영) 포맷 — 구 error-message 시맨틱 흡수
    const params = {
      required: formatSats(required ?? 0),
      available: formatSats(available ?? 0),
    }

    // 수수료 문구는 "원금은 충분한데 수수료가 부족을 만든" 경우에만 —
    // 도메인 getter isFeeShortage(fee>0 && available>=required)와 동일 시맨틱.
    // (구 error-i18n 은 fee>0 만 보던 근사 — 원금부터 부족한 경우에도 수수료
    // 문구를 내던 것을 일반 부족 문구로 정직화)
    if (fee && fee > 0 && (available ?? 0) >= (required ?? 0)) {
      return { key: 'errors.insufficientBalanceForFee', params }
    }

    return { key: 'errors.insufficientBalance', params }
  }

  if (code === 'MINT_CONNECTION' || code === 'MINT_UNREACHABLE') {
    const obj = err as Record<string, unknown>
    const mintUrl = obj.mintUrl as string | undefined
    // 민트명 해석: alias → hostname → 원문 (구 error-message 시맨틱 흡수)
    return {
      key: 'errors.mintConnection',
      params: { mint: mintUrl ? resolveMintDisplayName(mintUrl) : '' },
    }
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
