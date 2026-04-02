import i18n from '@/i18n'
import type { BaseError } from '@/core/errors/base'
import type { InsufficientBalanceError, MintConnectionError } from '@/core/errors/cashu'
import { formatSats } from '@/utils/format'

/** SCREAMING_SNAKE → camelCase: TOKEN_SPENT → tokenSpent */
function toCamelCase(code: string): string {
  return code.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

let mintNameResolver: ((mintUrl: string) => string | null) | null = null

export function setMintNameResolver(resolver: (mintUrl: string) => string | null): void {
  mintNameResolver = resolver
}

export function toErrorMessage(error: BaseError): string {
  const key = `errors.${toCamelCase(error.code)}`

  if (!i18n.exists(key)) return i18n.t('errors.unknownError')

  if (error.code === 'MINT_CONNECTION') {
    const e = error as MintConnectionError
    let mintName = e.mintUrl
    try {
      mintName = new URL(e.mintUrl).hostname
    } catch { /* fallback to url */ }
    if (mintNameResolver) {
      mintName = mintNameResolver(e.mintUrl) || mintName
    }
    return i18n.t(key, { mint: mintName })
  }

  if (error.code === 'INSUFFICIENT_BALANCE') {
    const e = error as InsufficientBalanceError
    const required = formatSats(e.required)
    const available = formatSats(e.available)
    if (e.isFeeShortage) {
      return i18n.t('errors.insufficientBalanceForFee', { required, available })
    }
    return i18n.t(key, { required, available })
  }

  return i18n.t(key)
}
