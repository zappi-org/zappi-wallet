/**
 * error-i18n — safety net for the error → user-message conversion contract.
 *
 * Pins that prevent real-incident regressions:
 * - SwapService wraps every runtime failure as UnknownError (code UNKNOWN). If
 *   UNKNOWN routes to the convention key (errors.unknown — absent in every locale),
 *   the literal "errors.unknown" shows in the toast. UNKNOWN must fall back to
 *   message-pattern matching.
 * - translateError never exposes a key missing from the locale as-is (i18next
 *   returns the key string when the key is absent).
 * - getErrorI18n's fixed set of emitted keys must exist in all five locales.
 */
import { describe, it, expect } from 'vitest'
import type { TFunction } from 'i18next'
import { getErrorI18n, translateError, setMintNameResolver } from '@/ui/utils/error-i18n'
import { UnknownError, NetworkError } from '@/core/errors/base'
import { AdapterNotFoundError, InsufficientBalanceError } from '@/core/errors/payment.errors'
import { MintConnectionError } from '@/core/errors/cashu'
import { formatSats } from '@/utils/format'
import en from '@/i18n/locales/en'
import ko from '@/i18n/locales/ko'
import ja from '@/i18n/locales/ja'
import es from '@/i18n/locales/es'
import id from '@/i18n/locales/id'

describe('getErrorI18n', () => {
  it('UnknownError(UNKNOWN) falls back to message-pattern matching instead of the convention key', () => {
    // Routing to the non-existent errors.unknown would expose the literal key in the toast.
    expect(getErrorI18n(new UnknownError('Quote expired during swap')).key).toBe('errors.quoteExpired')
    expect(getErrorI18n(new UnknownError('Not enough proofs available')).key).toBe(
      'errors.insufficientBalanceUnknown',
    )
    expect(getErrorI18n(new UnknownError('fetch failed')).key).toBe('errors.networkError')
    expect(getErrorI18n(new UnknownError('totally opaque failure')).key).toBe('errors.unknownError')
  })

  it('a non-UNKNOWN BaseError keeps its convention key', () => {
    expect(getErrorI18n(new AdapterNotFoundError('no lightning adapter')).key).toBe('errors.adapterNotFound')
    expect(getErrorI18n(new NetworkError('conn refused')).key).toBe('errors.networkError')
  })

  it('override takes priority over convention (InsufficientBalanceError param interpolation)', () => {
    // params is a formatSats-formatted string (honors unit settings) — old error-message semantics.
    expect(getErrorI18n(new InsufficientBalanceError(100, 40))).toEqual({
      key: 'errors.insufficientBalance',
      params: { required: formatSats(100), available: formatSats(40) },
    })
    // isFeeShortage (principal covered, short only on fee) → fee message.
    expect(getErrorI18n(new InsufficientBalanceError(100, 105, undefined, 10)).key).toBe(
      'errors.insufficientBalanceForFee',
    )
    // Even with fee>0, if the principal itself is short, use the general shortage
    // message (isFeeShortage domain-getter semantics — corrects the old fee>0 approximation).
    expect(getErrorI18n(new InsufficientBalanceError(100, 50, undefined, 10)).key).toBe(
      'errors.insufficientBalance',
    )
    // Drain mode with no amount info (0,0) — falsy check yields the simple message.
    expect(getErrorI18n(new InsufficientBalanceError(0, 0)).key).toBe('payment.insufficientBalance')
  })

  it('MINT_CONNECTION mint-name resolution: alias → hostname → original (legacy error-message semantics)', () => {
    // Resolver unregistered or unresolved — hostname fallback.
    setMintNameResolver(() => null)
    expect(getErrorI18n(new MintConnectionError('https://mint.example.com/api'))).toEqual({
      key: 'errors.mintConnection',
      params: { mint: 'mint.example.com' },
    })
    // URL not parseable — keep the original string.
    expect(getErrorI18n(new MintConnectionError('not-a-url')).params).toEqual({ mint: 'not-a-url' })

    // Resolver registered — alias takes top priority.
    setMintNameResolver((url) => (url === 'https://mint.example.com/api' ? 'My Mint' : null))
    expect(getErrorI18n(new MintConnectionError('https://mint.example.com/api')).params).toEqual({
      mint: 'My Mint',
    })
    setMintNameResolver(() => null)

    // Plain object has no mintUrl — empty string (preserves the existing contract).
    expect(getErrorI18n({ code: 'MINT_UNREACHABLE' }).params).toEqual({ mint: '' })
  })

  it('[current contract] plain object(UNKNOWN) → unknownError — only Error instances can message-match', () => {
    // branch 3 matches String(error) ('[object Object]'), so it can't read a plain
    // object's message. All domain errors are BaseError (Error) instances, so real paths are unaffected.
    expect(getErrorI18n({ code: 'UNKNOWN', message: 'request timed out' }).key).toBe('errors.unknownError')
    // With the same message, pattern matching works when it's an Error instance.
    expect(getErrorI18n(new UnknownError('request timed out')).key).toBe('errors.timeoutError')
  })
})

describe('translateError', () => {
  it('a key absent from the locale is downgraded to errors.unknownError instead of exposing the literal', () => {
    // Mimic i18next: translate only known keys, return the key string for unknown ones.
    const t = ((key: string) => (key === 'errors.unknownError' ? 'Something went wrong' : key)) as unknown as TFunction
    const futureError = { code: 'SOME_FUTURE_CODE', message: 'x' }
    expect(translateError(futureError, t)).toBe('Something went wrong')
  })

  it('returns the translation as-is when the key exists', () => {
    const t = ((key: string) => (key === 'errors.adapterNotFound' ? '결제 수단 없음' : key)) as unknown as TFunction
    expect(translateError(new AdapterNotFoundError('no adapter'), t)).toBe('결제 수단 없음')
  })
})

describe('emitted key set — must exist in all five locales', () => {
  // Full list of fixed keys getErrorI18n can emit (convention dynamic keys excluded —
  // those are covered by translateError's key-absence downgrade).
  const EMITTED_KEYS = [
    'errors.tokenSpent',
    'errors.insufficientBalance',
    'errors.insufficientBalanceUnknown',
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
    // Codes that began routing through convention after core services switched from
    // raw throws to domain errors. The key-absence downgrade guards them, but
    // downgrading kills diagnostic info, so we pin their existence.
    'errors.serviceNotReady',
    'errors.invalidDestination',
    'errors.unrecognizedInput',
    'errors.lnurlParseFailed',
    'errors.transferStateInvalid',
    'errors.receiveRequestInvalid',
    'errors.supportTicketResolved',
  ] as const

  const LOCALES = { en, ko, ja, es, id } as const

  function lookup(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>(
      (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
      obj,
    )
  }

  it.each(Object.keys(LOCALES) as Array<keyof typeof LOCALES>)('%s locale', (locale) => {
    for (const key of EMITTED_KEYS) {
      expect(typeof lookup(LOCALES[locale], key), `${locale} 에 ${key} 누락`).toBe('string')
    }
  })
})
