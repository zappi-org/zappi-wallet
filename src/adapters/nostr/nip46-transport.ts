/**
 * Nip46Transport — SignerTransport implementation.
 *
 * Relay lifecycle is delegated to a dedicated NostrSessionController (scoped
 * subscriptions), so NIP-46 sessions get the same reconnect/wake/attach
 * guarantees as the wallet without touching its persistent relay set. Crypto is
 * the same local primitives the gateway uses (internal/nostr-crypto).
 */

import type { NostrEvent, UnsignedNostrEvent } from '@/core/domain/nostr'
import { SIGNER_REQUEST_KIND, type SignerResponse } from '@/core/domain/remote-signing'
import type { SignerTransport } from '@/core/ports/driven/signer-transport.port'
import { NostrSessionController } from './internal/session-controller'
import {
  decrypt,
  derivePublicKey,
  encrypt,
  getConversationKey,
  signEvent,
  verifyEventSignature,
} from './internal/nostr-crypto'

export class Nip46Transport implements SignerTransport {
  private readonly selfPubkey: string
  private readonly controller: NostrSessionController

  constructor(
    private readonly privateKeyHex: string,
    deps?: { controller?: NostrSessionController },
  ) {
    this.selfPubkey = derivePublicKey(privateKeyHex)
    this.controller = deps?.controller ?? new NostrSessionController()
  }

  subscribe(relays: string[], onRequest: (event: NostrEvent) => void): () => void {
    const filter = { kinds: [SIGNER_REQUEST_KIND], '#p': [this.selfPubkey] }
    // Drop unsigned/forged events at the boundary before the service sees them.
    return this.controller.subscribeScoped(
      [filter],
      (event) => {
        if (verifyEventSignature(event)) onRequest(event)
      },
      relays,
    )
  }

  async respond(
    clientPubkey: string,
    relays: string[],
    response: SignerResponse,
  ): Promise<void> {
    const content = this.encrypt(clientPubkey, JSON.stringify(response))
    const signed = signEvent(
      {
        pubkey: this.selfPubkey,
        created_at: Math.floor(Date.now() / 1000),
        kind: SIGNER_REQUEST_KIND,
        tags: [['p', clientPubkey]],
        content,
      },
      this.privateKeyHex,
    )
    await this.controller.publishScoped(relays, signed)
  }

  encrypt(counterpartyPubkey: string, plaintext: string): string {
    return encrypt(plaintext, this.conversationKey(counterpartyPubkey))
  }

  decrypt(counterpartyPubkey: string, ciphertext: string): string {
    return decrypt(ciphertext, this.conversationKey(counterpartyPubkey))
  }

  signEvent(event: UnsignedNostrEvent): NostrEvent {
    return signEvent(event, this.privateKeyHex)
  }

  dispose(): void {
    this.controller.disconnect()
  }

  private conversationKey(counterpartyPubkey: string): Uint8Array {
    return getConversationKey(this.privateKeyHex, counterpartyPubkey)
  }
}
