import { HDKey } from '@scure/bip32'
import { hmac } from '@noble/hashes/hmac.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import type { KeyDeriver, DerivedKey } from '@/core/ports/driven/key-deriver.port'

const PURPOSES: Record<string, (seed: Uint8Array, context: string) => HDKey> = {
  'lnurl-auth': deriveLnurlAuthKey,
}

export class Secp256k1KeyDeriverAdapter implements KeyDeriver {
  private readonly seed: Uint8Array

  constructor(seed: Uint8Array) {
    this.seed = seed
  }

  async deriveKey(purpose: string, context: string): Promise<DerivedKey> {
    const hdkey = this.derive(purpose, context)
    return { publicKey: bytesToHex(hdkey.publicKey!.slice(1)) }
  }

  async sign(
    message: Uint8Array,
    purpose: string,
    context: string,
  ): Promise<Uint8Array> {
    const hdkey = this.derive(purpose, context)
    return secp256k1.sign(message, hdkey.privateKey!, { format: 'der', prehash: false })
  }

  private derive(purpose: string, context: string): HDKey {
    const deriver = PURPOSES[purpose]
    if (!deriver) throw new Error(`Unknown key purpose: ${purpose}`)
    return deriver(this.seed, context)
  }
}

// ── LUD-05: LNURL-auth BIP32 key derivation ──

function deriveLnurlAuthKey(seed: Uint8Array, domain: string): HDKey {
  const master = HDKey.fromMasterSeed(seed)
  const hashingKey = hmac(sha256, seed, new TextEncoder().encode('lnurlauth'))

  const domainBytes = new TextEncoder().encode(domain)
  const domainHash = hmac(sha256, hashingKey, domainBytes)
  const view = new DataView(domainHash.buffer, domainHash.byteOffset, domainHash.byteLength)

  const path = [
    138,
    view.getUint32(0) & 0x7fffffff,
    view.getUint32(4) & 0x7fffffff,
    view.getUint32(8) & 0x7fffffff,
    view.getUint32(12) & 0x7fffffff,
  ]
    .map((i) => `${i}'`)
    .join('/')

  return master.derive(`m/${path}`)
}
