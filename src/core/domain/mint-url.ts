/**
 * Mint URL equality — a domain rule (zero dependencies, pure functions) shared by
 * routing (fee selection), recovery, and balance display. utils/url.ts keeps a
 * backward-compatible re-export (existing callers unchanged).
 *
 * The split between the two normalizations is a contract:
 * - normalizeMintUrl: storage/wire normalization — meaning frozen. Never lowercase
 *   or strip the port (a key mismatch with existing stored data = funds-display bug).
 * - mintUrlKey: comparison-only canonical — absorbs host case, default ports
 *   (:443/:80), trailing slash, and omitted protocol. Never store or send its return value.
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
 * Comparison-only canonical key for mint URLs.
 * Path case is preserved (paths are case-sensitive resources).
 * Unparseable strings fall back to the normalizeMintUrl result as the key.
 * userinfo and fragment are dropped by URL serialization — unused in real mint URLs.
 */
export function mintUrlKey(url: string): string {
  const normalized = normalizeMintUrl(url)
  try {
    const u = new URL(normalized)
    const isDefaultPort =
      u.port === '' ||
      (u.protocol === 'https:' && u.port === '443') ||
      (u.protocol === 'http:' && u.port === '80')
    const port = isDefaultPort ? '' : `:${u.port}`
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.protocol}//${u.hostname.toLowerCase()}${port}${path}${u.search}`
  } catch {
    return normalized
  }
}

/** Whether two mint URLs point to the same mint — absorbs notation variants (case, :443, slash) */
export function isSameMintUrl(a: string, b: string): boolean {
  return mintUrlKey(a) === mintUrlKey(b)
}
