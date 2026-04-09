import * as bip39 from '@scure/bip39'
import type { SeedCache } from '@/core/ports/driven/seed-cache.port'

// SeedCache instance — injected from composition layer
let seedCache: SeedCache | null = null

/**
 * Inject the SeedCache adapter. Must be called before any seed operations.
 * Called by composition/bootstrap.ts or composition/security.ts.
 */
export function injectSeedCache(cache: SeedCache): void {
  seedCache = cache
}

function requireCache(): SeedCache {
  if (!seedCache) throw new Error('SeedCache not injected. Call injectSeedCache() first.')
  return seedCache
}

export function clearCachedMnemonic(): void {
  requireCache().clearCache()
}

export function isMnemonicCached(): boolean {
  return seedCache?.isCached() ?? false
}

export function setCachedMnemonic(mnemonic: string): void {
  requireCache().cacheMnemonic(mnemonic)
}

/**
 * Coco Manager용 시드 getter
 * BIP-39 표준 시드 (64바이트) 반환
 */
export async function getSeed(): Promise<Uint8Array> {
  const mnemonic = requireCache().getCachedMnemonic()
  if (mnemonic) {
    return bip39.mnemonicToSeedSync(mnemonic)
  }
  throw new Error('Seed not available: wallet must be unlocked first')
}
