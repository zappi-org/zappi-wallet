import type { TFunction } from 'i18next'
import { BaseError } from '@/core/errors/base'
import type { TranslationKey } from '@/i18n'
import { formatSats } from '@/utils/format'

/**
 * Error → i18n key + params resolver
 *
 * BaseError (has code) → convention-based i18n key + param extraction
 * Raw error (no code) → message pattern-matching fallback
 *
 * Convention: ERROR_CODE → errors.errorCode (camelCase)
 * e.g. TOKEN_SPENT → errors.tokenSpent
 */

export interface ErrorI18n {
  key: TranslationKey
  params?: Record<string, unknown>
}

function codeToCamelCase(code: string): string {
  return code.toLowerCase().replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())
}

/** Mint display-name resolver — MainApp registers the mintAliases lookup. */
let mintNameResolver: ((mintUrl: string) => string | null) | null = null

export function setMintNameResolver(resolver: (mintUrl: string) => string | null): void {
  mintNameResolver = resolver
}

/** Resolves a mint's display name: alias → hostname → raw URL. */
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
 * Returns the i18n key + interpolation params for an error object.
 * Use as t(result.key, result.params).
 */
export function getErrorI18n(error: unknown): ErrorI18n {
  // 1. BaseError instance (domain error)
  if (error instanceof BaseError) {
    const override = resolveOverride(error)
    if (override) return override
    // UNKNOWN is just a wrapper around a cause message — don't route it to a
    // convention key (errors.unknown exists in no locale); fall through to the
    // message pattern matching below to preserve diagnostic info like
    // "insufficient/expired/network" (same rule as branch 2).
    if (error.code !== 'UNKNOWN') {
      // convention key — runtime-guarded in translateError (missing keys demote to unknownError)
      return { key: `errors.${codeToCamelCase(error.code)}` as TranslationKey }
    }
  }

  // 2. Object with a code property (SDK errors, Result errors, etc.)
  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>
    const code = err.code

    // Direct TokenSpentError check (plain object, not an instance)
    if (code === 'TOKEN_SPENT') {
      return { key: 'errors.tokenSpent' }
    }

    if (typeof code === 'string' && code !== 'UNKNOWN') {
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
  if (msg.includes('not enough proofs') || msg.includes('insufficient')) {
    return { key: 'errors.insufficientBalanceUnknown' }
  }
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
 * Extracts i18n key overrides + interpolation params from BaseError subclasses.
 * Returns a more specific key or params per error code.
 */
function resolveOverride(err: Record<string, unknown> | BaseError): ErrorI18n | undefined {
  const code = err.code as string

  if (code === 'INSUFFICIENT_BALANCE') {
    const obj = err as Record<string, unknown>
    const required = obj.required as number | undefined
    const available = obj.available as number | undefined
    const fee = obj.fee as number | undefined

    // No amount info → plain message
    if (!required && !available) {
      return { key: 'payment.insufficientBalance' }
    }

    // Format amounts with formatSats (respects unit settings)
    const params = {
      required: formatSats(required ?? 0),
      available: formatSats(available ?? 0),
    }

    // Fee wording only when the principal is sufficient but the fee creates the
    // shortfall — same semantics as the domain getter isFeeShortage
    // (fee>0 && available>=required).
    if (fee && fee > 0 && (available ?? 0) >= (required ?? 0)) {
      return { key: 'errors.insufficientBalanceForFee', params }
    }

    return { key: 'errors.insufficientBalance', params }
  }

  if (code === 'MINT_CONNECTION' || code === 'MINT_UNREACHABLE') {
    const obj = err as Record<string, unknown>
    const mintUrl = obj.mintUrl as string | undefined
    // Mint name resolution: alias → hostname → raw URL
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
 * Combines with the t function to return a translated error message directly.
 * Usage: translateError(err, t)
 */
export function translateError(error: unknown, t: TFunction): string {
  const { key, params } = getErrorI18n(error)
  const translated = t(key, params)
  // If a convention key is missing from the locale, i18next returns the key
  // string as-is — demote to a generic error message so the user never sees a
  // literal "errors.xxx", but keep the key gap audible to developers (no silent
  // swallow).
  if (translated === key) {
    console.warn('[error-i18n] missing locale key:', key)
    return t('errors.unknownError')
  }
  return translated
}
