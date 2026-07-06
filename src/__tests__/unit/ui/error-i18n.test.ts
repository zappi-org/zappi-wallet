/**
 * error-i18n — 에러 → 사용자 문구 변환 계약 안전망 (Phase 0 비관 리뷰 B-1)
 *
 * 실사고 재발 방지 핀:
 * - SwapService 는 모든 런타임 실패를 UnknownError(code UNKNOWN)로 감싼다.
 *   UNKNOWN 이 convention 키(errors.unknown — 어느 로케일에도 없음)로 가면
 *   토스트에 리터럴 "errors.unknown" 이 노출된다. UNKNOWN 은 반드시
 *   메시지 패턴 매칭으로 폴백해야 한다.
 * - translateError 는 로케일에 없는 키를 절대 그대로 노출하지 않는다
 *   (i18next 는 키 부재 시 키 문자열을 반환).
 * - getErrorI18n 의 고정 방출 키 집합은 5개 로케일 전부에 존재해야 한다.
 */
import { describe, it, expect } from 'vitest'
import { getErrorI18n, translateError } from '@/ui/utils/error-i18n'
import { UnknownError, NetworkError } from '@/core/errors/base'
import { AdapterNotFoundError, InsufficientBalanceError } from '@/core/errors/payment.errors'
import en from '@/i18n/locales/en'
import ko from '@/i18n/locales/ko'
import ja from '@/i18n/locales/ja'
import es from '@/i18n/locales/es'
import id from '@/i18n/locales/id'

describe('getErrorI18n', () => {
  it('UnknownError(UNKNOWN) 는 convention 키 대신 메시지 패턴 매칭으로 폴백한다', () => {
    // 존재하지 않는 errors.unknown 으로 가면 리터럴 키가 토스트에 노출된다 (B-1)
    expect(getErrorI18n(new UnknownError('Quote expired during swap')).key).toBe('errors.quoteExpired')
    expect(getErrorI18n(new UnknownError('Not enough proofs available')).key).toBe('errors.insufficientBalance')
    expect(getErrorI18n(new UnknownError('fetch failed')).key).toBe('errors.networkError')
    expect(getErrorI18n(new UnknownError('totally opaque failure')).key).toBe('errors.unknownError')
  })

  it('UNKNOWN 이 아닌 BaseError 는 convention 키 유지', () => {
    expect(getErrorI18n(new AdapterNotFoundError('no lightning adapter')).key).toBe('errors.adapterNotFound')
    expect(getErrorI18n(new NetworkError('conn refused')).key).toBe('errors.networkError')
  })

  it('오버라이드가 convention 보다 우선한다 (InsufficientBalanceError 파라미터 보간)', () => {
    expect(getErrorI18n(new InsufficientBalanceError(100, 40))).toEqual({
      key: 'errors.insufficientBalance',
      params: { required: 100, available: 40 },
    })
    expect(getErrorI18n(new InsufficientBalanceError(100, 105, undefined, 10)).key).toBe(
      'errors.insufficientBalanceForFee',
    )
    // 금액 정보 없는 drain 모드(0,0) — falsy 체크로 단순 문구
    expect(getErrorI18n(new InsufficientBalanceError(0, 0)).key).toBe('payment.insufficientBalance')
  })

  it('[현재 계약] plain object(UNKNOWN) 는 unknownError — Error 인스턴스만 메시지 매칭 가능', () => {
    // branch 3 은 String(error)('[object Object]') 를 매칭하므로 plain object 의
    // message 는 읽지 못한다. 도메인 에러는 전부 BaseError(Error) 인스턴스라 실경로 무영향.
    expect(getErrorI18n({ code: 'UNKNOWN', message: 'request timed out' }).key).toBe('errors.unknownError')
    // 같은 메시지라도 Error 인스턴스면 패턴 매칭이 동작한다
    expect(getErrorI18n(new UnknownError('request timed out')).key).toBe('errors.timeoutError')
  })
})

describe('translateError', () => {
  it('로케일에 없는 키는 리터럴 노출 대신 errors.unknownError 로 강등한다', () => {
    // i18next 흉내: 아는 키만 번역, 모르는 키는 키 문자열 그대로 반환
    const t = (key: string) => (key === 'errors.unknownError' ? 'Something went wrong' : key)
    const futureError = { code: 'SOME_FUTURE_CODE', message: 'x' }
    expect(translateError(futureError, t)).toBe('Something went wrong')
  })

  it('키가 존재하면 번역 결과를 그대로 반환한다', () => {
    const t = (key: string) => (key === 'errors.adapterNotFound' ? '결제 수단 없음' : key)
    expect(translateError(new AdapterNotFoundError('no adapter'), t)).toBe('결제 수단 없음')
  })
})

describe('방출 키 집합 — 5개 로케일 전부에 존재해야 한다', () => {
  // getErrorI18n 소스가 방출할 수 있는 고정 키의 전체 목록 (convention 동적 키 제외 —
  // 그쪽은 translateError 의 키-부재 강등이 안전망)
  const EMITTED_KEYS = [
    'errors.tokenSpent',
    'errors.insufficientBalance',
    'errors.insufficientBalanceForFee',
    'errors.timeoutError',
    'errors.quoteExpired',
    'errors.mintConnection',
    'errors.networkError',
    'errors.invalidToken',
    'errors.lightningRouting',
    'errors.unknownError',
    'errors.adapterNotFound',
    'payment.insufficientBalance',
    'receive.tokenReceiveFeeTooHigh',
  ] as const

  const LOCALES = { en, ko, ja, es, id } as const

  function lookup(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>(
      (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
      obj,
    )
  }

  it.each(Object.keys(LOCALES) as Array<keyof typeof LOCALES>)('%s 로케일', (locale) => {
    for (const key of EMITTED_KEYS) {
      expect(typeof lookup(LOCALES[locale], key), `${locale} 에 ${key} 누락`).toBe('string')
    }
  })
})
