import type { TransactionSource } from '@/core/types'

const SOURCE_PREFIXES: Array<[string, TransactionSource]> = [
  ['zappi-pos_', 'zappi-pos'],
  ['zappi-kiosk_', 'zappi-kiosk'],
  ['zappi-api_', 'zappi-api'],
  ['zappi-link_', 'zappi-link'],
  ['wallet_', 'wallet'],
]

/**
 * Parse transaction source from NUT-18 request ID prefix
 */
export function parseTransactionSource(requestId?: string): TransactionSource {
  if (!requestId) return 'unknown'
  for (const [prefix, source] of SOURCE_PREFIXES) {
    if (requestId.startsWith(prefix)) return source
  }
  return 'unknown'
}
