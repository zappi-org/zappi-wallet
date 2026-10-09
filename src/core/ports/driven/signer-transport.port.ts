import type { NostrEvent, UnsignedNostrEvent } from '@/core/domain/nostr'
import type { SignerResponse } from '@/core/domain/remote-signing'

/**
 * SignerTransport — relay transport + local crypto for the NIP-46 signer.
 *
 * The adapter owns the signer keypair; callers never pass keys.
 */
export interface SignerTransport {
  /** Subscribe to incoming requests addressed to this signer across `relays`. */
  subscribe(relays: string[], onRequest: (event: NostrEvent) => void): () => void

  /** NIP-44 encrypt to `clientPubkey` (content), sign, and publish on `relays`. */
  respond(clientPubkey: string, relays: string[], response: SignerResponse): Promise<void>

  encrypt(counterpartyPubkey: string, plaintext: string): string
  decrypt(counterpartyPubkey: string, ciphertext: string): string

  signEvent(event: UnsignedNostrEvent): NostrEvent

  /** Tear down relay subscriptions and pool. */
  dispose(): void
}
