import type { TranslationKey } from '@/i18n'
import type { TransactionSource } from '@/core/types/wallet'

/**
 * Transaction source → i18n key. Fallback helper that keeps an unknown source
 * value from leaking through the dynamic key cast as a literal "txDetail.source.xxx".
 * The record-side value domain and the locale key set meet here as a single source of truth.
 */
const KNOWN_TX_SOURCES = [
  'zappi-pos',
  'zappi-kiosk',
  'zappi-api',
  'zappi-link',
  'wallet',
  'unknown',
] as const satisfies readonly TransactionSource[]

export function txSourceKey(source: string): TranslationKey {
  const known = (KNOWN_TX_SOURCES as readonly string[]).includes(source)
  return `txDetail.source.${known ? source : 'unknown'}` as TranslationKey
}
