import { signEvent, derivePublicKey, npubEncode } from '@/adapters/nostr/internal/nostr-crypto'
import { NOSTR_KINDS } from '@/core/constants'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'

export class Secp256k1NostrSignerAdapter implements NostrSigner {
  private cachedPubkey: string | null = null

  constructor(private readonly privateKeyHex: string) {}

  createNip98Token(url: string, method: string): string {
    const event = signEvent(
      {
        kind: NOSTR_KINDS.NIP98_AUTH,
        content: '',
        tags: [
          ['u', url],
          ['method', method.toUpperCase()],
        ],
        created_at: Math.floor(Date.now() / 1000),
        pubkey: this.getPublicKey(),
      },
      this.privateKeyHex,
    )
    return btoa(JSON.stringify(event))
  }

  getPublicKey(): string {
    if (!this.cachedPubkey) {
      this.cachedPubkey = derivePublicKey(this.privateKeyHex)
    }
    return this.cachedPubkey
  }

  getNpub(): string {
    return npubEncode(this.getPublicKey())
  }
}
