/**
 * URL normalization utilities for mints and relays
 * Based on cashu.me and go-nostr conventions
 */

// Mint URL equivalence (storage normalization + canonical comparison) is a domain
// rule — moved to core/domain. Backward-compat re-export for existing callers.
export { normalizeMintUrl, mintUrlKey, isSameMintUrl } from '@/core/domain/mint-url'
import { mintUrlKey } from '@/core/domain/mint-url'

/**
 * Extract hostname from URL for display
 */
export function formatMintHost(url: string): string {
  try { return new URL(url).hostname } catch { return url }
}


/**
 * Strip trailing slash from URL (lightweight normalization for comparison)
 */
export function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/**
 * Get mint balance with URL normalization fallback.
 * byMint keys are coco-canonical while the UI holds settings raw — when a
 * direct/trailing-slash match fails, fall back to mintUrlKey equivalence so
 * formatting variants don't get missed.
 */
export function getMintBalance(url: string, balanceByMint: Record<string, number>): number {
  const direct = balanceByMint[stripTrailingSlash(url)] ?? balanceByMint[url]
  if (direct !== undefined) return direct

  const key = mintUrlKey(url)
  for (const [candidate, balance] of Object.entries(balanceByMint)) {
    if (mintUrlKey(candidate) === key) return balance
  }
  return 0
}

/**
 * Normalize relay URL (go-nostr convention)
 * - Converts http:// to ws://, https:// to wss://
 * - Adds wss:// if no protocol
 * - Removes trailing slashes
 */
export function normalizeRelayUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, '')

  if (/^http:\/\//i.test(cleaned)) {
    cleaned = cleaned.replace(/^http:\/\//i, 'ws://')
  } else if (/^https:\/\//i.test(cleaned)) {
    cleaned = cleaned.replace(/^https:\/\//i, 'wss://')
  } else if (!/^wss?:\/\//i.test(cleaned)) {
    cleaned = 'wss://' + cleaned
  }

  return cleaned
}
