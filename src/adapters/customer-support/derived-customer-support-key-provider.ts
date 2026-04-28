import { HDKey } from '@scure/bip32'
import { finalizeEvent, getPublicKey } from 'nostr-tools'
import * as nip44 from 'nostr-tools/nip44'
import type { KeyProvider, SignedEvent, UnsignedEvent } from 'nostr-cs'

const CUSTOMER_SUPPORT_DERIVATION_PATH = "m/129372'/2'/0'"

export class DerivedCustomerSupportKeyProvider implements KeyProvider {
  private readonly privateKey: Uint8Array
  private readonly publicKey: string
  private destroyed = false

  constructor(seed: Uint8Array) {
    const root = HDKey.fromMasterSeed(seed)
    let derived: HDKey | undefined

    try {
      derived = root.derive(CUSTOMER_SUPPORT_DERIVATION_PATH)
      if (!derived.privateKey) {
        throw new Error('Customer support key derivation failed')
      }

      this.privateKey = new Uint8Array(derived.privateKey)
      this.publicKey = getPublicKey(this.privateKey)
    } finally {
      derived?.wipePrivateData()
      root.wipePrivateData()
    }
  }

  async getPubkey(): Promise<string> {
    this.assertUsable()
    return this.publicKey
  }

  async sign(event: UnsignedEvent): Promise<SignedEvent> {
    this.assertUsable()
    return finalizeEvent(event, this.privateKey) as SignedEvent
  }

  async encrypt(plaintext: string, recipientPubkey: string): Promise<string> {
    this.assertUsable()
    const conversationKey = nip44.v2.utils.getConversationKey(this.privateKey, recipientPubkey)
    try {
      return nip44.v2.encrypt(plaintext, conversationKey)
    } finally {
      conversationKey.fill(0)
    }
  }

  async decrypt(ciphertext: string, senderPubkey: string): Promise<string> {
    this.assertUsable()
    const conversationKey = nip44.v2.utils.getConversationKey(this.privateKey, senderPubkey)
    try {
      return nip44.v2.decrypt(ciphertext, conversationKey)
    } finally {
      conversationKey.fill(0)
    }
  }

  destroy(): void {
    this.privateKey.fill(0)
    this.destroyed = true
  }

  private assertUsable(): void {
    if (this.destroyed) {
      throw new Error('Customer support key provider is destroyed')
    }
  }
}
