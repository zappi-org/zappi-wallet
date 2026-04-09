/**
 * Composition root for SecurityUseCase
 *
 * Adapter → Port → Service 와이어링.
 * UI에서 import하는 유일한 진입점.
 */

import { KeyManagerAdapter } from '@/adapters/crypto/key-manager.adapter'
import { EncryptionAdapter } from '@/adapters/crypto/encryption.adapter'
import { SecureStorageAdapter } from '@/adapters/storage/secure-storage.adapter'
import { SeedCacheAdapter } from '@/adapters/coco/seed-cache.adapter'
import { SecurityService } from '@/core/services/security.service'
import type { SecurityUseCase } from '@/core/ports/driving/security.usecase'
import { injectSeedCache } from '@/modules/cashu'

let _instance: SecurityUseCase | null = null

export function createSecurityService(): SecurityUseCase {
  if (_instance) return _instance
  const seedCache = new SeedCacheAdapter()
  // Inject into seed-getter so Coco Manager can access cached mnemonic
  injectSeedCache(seedCache)
  _instance = new SecurityService(
    new KeyManagerAdapter(),
    new EncryptionAdapter(),
    new SecureStorageAdapter(),
    seedCache,
  )
  return _instance
}
