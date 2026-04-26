import type { SeedCache } from '@/core/ports/driven/seed-cache.port'

/**
 * SeedCacheAdapter — owns the mnemonic cache state.
 * Cashu seed loading accesses this via the SeedCache port.
 */
export class SeedCacheAdapter implements SeedCache {
  private mnemonic: string | null = null

  cacheMnemonic(mnemonic: string): void {
    this.mnemonic = mnemonic
  }

  getCachedMnemonic(): string | null {
    return this.mnemonic
  }

  isCached(): boolean {
    return this.mnemonic !== null
  }

  clearCache(): void {
    this.mnemonic = null
  }
}
