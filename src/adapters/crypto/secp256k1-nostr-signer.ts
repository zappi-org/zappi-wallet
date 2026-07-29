import { finalizeEvent, getPublicKey } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { hexToBytes } from '@noble/hashes/utils.js'
import { NOSTR_KINDS } from '@/core/constants'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'

export class Secp256k1NostrSignerAdapter implements NostrSigner {
  private cachedPubkey: string | null = null

  constructor(private readonly privateKeyHex: string) {}

  createNip98Token(url: string, method: string): string {
    const event = finalizeEvent(
      {
        kind: NOSTR_KINDS.NIP98_AUTH,
        content: '',
        tags: [
          ['u', url],
          ['method', method.toUpperCase()],
        ],
        created_at: Math.floor(Date.now() / 1000),
      },
      hexToBytes(this.privateKeyHex)
    )
    return btoa(JSON.stringify(event))
  }

  getPublicKey(): string {
    if (!this.cachedPubkey) {
      this.cachedPubkey = getPublicKey(hexToBytes(this.privateKeyHex))
    }
    return this.cachedPubkey
  }

  getNpub(): string {
    return nip19.npubEncode(this.getPublicKey())
  }
}
