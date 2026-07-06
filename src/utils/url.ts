/**
 * URL normalization utilities for mints and relays
 * Based on cashu.me and go-nostr conventions
 */

// 민트 URL 동등성(저장 정규화 + 비교 canonical)은 도메인 규칙 — core/domain 으로
// 이동 (Phase 2 이중 리뷰 층위 판정). 기존 호출부를 위한 하위호환 re-export.
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
 * byMint 키는 coco-canonical 인데 UI 는 settings raw 를 들고 온다 (감사 MAJOR-7) —
 * 직접/슬래시 매치 실패 시 mintUrlKey 동등성으로 폴백해 표기 변형 미스를 없앤다.
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
