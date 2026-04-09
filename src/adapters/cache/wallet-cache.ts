import { Wallet } from '@cashu/cashu-ts'
import { CASHU_UNIT } from '@/core/constants'

/**
 * Normalize mint URL (remove trailing slash)
 */
function normalizeMintUrl(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/**
 * Global wallet cache instance
 */
let globalCache: Map<string, Wallet> | null = null

function getGlobalCache(): Map<string, Wallet> {
  if (!globalCache) {
    globalCache = new Map()
  }
  return globalCache
}

/**
 * Clear the global wallet cache (for testing)
 */
export function clearWalletCache(): void {
  globalCache = null
}

/**
 * Singleton cache for Wallet instances
 * Prevents creating multiple wallet instances for the same mint
 */
export class WalletCache {
  private get cache(): Map<string, Wallet> {
    return getGlobalCache()
  }

  /**
   * Get or create a wallet for the given mint URL
   */
  async getWallet(mintUrl: string): Promise<Wallet> {
    const normalizedUrl = normalizeMintUrl(mintUrl)

    // Return cached wallet if exists
    const cached = this.cache.get(normalizedUrl)
    if (cached) {
      return cached
    }

    // Create new wallet (cashu-ts v3 API)
    const wallet = new Wallet(normalizedUrl, { unit: CASHU_UNIT })

    // Load mint keys
    await wallet.loadMint()

    // Cache and return
    this.cache.set(normalizedUrl, wallet)
    return wallet
  }

  /**
   * Check if a wallet is cached for the given mint URL
   */
  hasWallet(mintUrl: string): boolean {
    const normalizedUrl = normalizeMintUrl(mintUrl)
    return this.cache.has(normalizedUrl)
  }

  /**
   * Remove a wallet from cache
   */
  removeWallet(mintUrl: string): void {
    const normalizedUrl = normalizeMintUrl(mintUrl)
    this.cache.delete(normalizedUrl)
  }

  /**
   * Clear all cached wallets
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get list of cached mint URLs
   */
  getCachedMints(): string[] {
    return Array.from(this.cache.keys())
  }
}

// Re-export Wallet type for consumers
export type { Wallet }

/**
 * Singleton instance
 */
let walletCacheInstance: WalletCache | null = null

/**
 * Get the wallet cache singleton
 */
export function getWalletCache(): WalletCache {
  if (!walletCacheInstance) {
    walletCacheInstance = new WalletCache()
  }
  return walletCacheInstance
}

/**
 * Clear the wallet cache singleton (for logout)
 */
export function resetWalletCache(): void {
  if (walletCacheInstance) {
    walletCacheInstance.clear()
    walletCacheInstance = null
  }
}
