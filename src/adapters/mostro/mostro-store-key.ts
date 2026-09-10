import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'

const SALT = new TextEncoder().encode('zappi-mostro-store')
const INFO = new TextEncoder().encode('field-encryption-v1')

/**
 * Derive the 32-byte at-rest key for the Mostro store from the wallet seed.
 *
 * Domain-separated so the store key never equals any wallet/other-purpose key.
 */
export function deriveMostroStoreKey(seed: Uint8Array): Uint8Array {
  return hkdf(sha256, seed, SALT, INFO, 32)
}
