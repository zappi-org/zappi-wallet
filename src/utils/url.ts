/**
 * URL normalization utilities for mints and relays
 * Based on cashu.me and go-nostr conventions
 */

/**
 * Normalize mint URL (cashu.me convention)
 * - Adds https:// if no protocol
 * - Removes trailing slashes
 */
export function normalizeMintUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, '')
  if (!/^[a-z]+:\/\//i.test(cleaned)) {
    cleaned = 'https://' + cleaned
  }
  return cleaned
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
