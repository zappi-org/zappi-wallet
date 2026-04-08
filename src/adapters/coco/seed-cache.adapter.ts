import type { SeedCache } from '@/core/ports/driven/seed-cache.port'
import { setCachedMnemonic, clearCachedMnemonic } from '@/modules/cashu'

export class SeedCacheAdapter implements SeedCache {
  cacheMnemonic(mnemonic: string): void {
    setCachedMnemonic(mnemonic)
  }

  clearCache(): void {
    clearCachedMnemonic()
  }
}
