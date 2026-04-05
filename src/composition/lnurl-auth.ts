/**
 * Composition root for LnurlAuthUseCase
 *
 * seed는 bootstrap(MainApp)에서 unlock 후 전달.
 * composition이 SecurityService를 호출하면 안 됨.
 */

import { LnurlAuthService } from '@/core/services/lnurl-auth.service'
import { DirectLnurlAdapter } from '@/adapters/lnurl/direct-lnurl.adapter'
import { Secp256k1KeyDeriverAdapter } from '@/adapters/crypto/secp256k1-key-deriver.adapter'
import type { LnurlAuthUseCase } from '@/core/ports/driving/lnurl-auth.usecase'

export function createLnurlAuthService(
  seed: Uint8Array,
): LnurlAuthUseCase {
  const lnurlAdapter = new DirectLnurlAdapter()
  const keyDeriver = new Secp256k1KeyDeriverAdapter(seed)
  return new LnurlAuthService(lnurlAdapter, keyDeriver)
}
