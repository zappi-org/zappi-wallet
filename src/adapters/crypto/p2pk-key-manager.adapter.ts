import type { P2PKKeyManager } from '@/core/ports/driven/p2pk-key-manager.port'

/**
 * Keypair shape returned by coco-cashu-core KeyRingApi.
 * Defined here to avoid importing SDK types directly.
 */
interface KeyRingPair {
  publicKeyHex: string
  secretKey?: Uint8Array
}

interface KeyRingApi {
  generateKeyPair(dumpSecretKey?: boolean): Promise<KeyRingPair>
  addKeyPair(secretKey: Uint8Array): Promise<KeyRingPair>
  getLatestKeyPair(): Promise<KeyRingPair | null>
}

/**
 * P2PK key manager backed by Coco SDK's KeyRingService.
 *
 * Keys are derived via BIP-32 (m/129373'/10'/0'/0'/<index>)
 * and persisted in SDK's IndexedDB. signProof() automatically
 * uses the same storage, so no sync is needed.
 */
export class CocoP2PKKeyManager implements P2PKKeyManager {
  constructor(private readonly getKeyring: () => Promise<KeyRingApi>) {}

  async getCurrentKey(): Promise<{ pubkey: string }> {
    const keyring = await this.getKeyring()
    const latest = await keyring.getLatestKeyPair()
    if (latest) {
      return { pubkey: latest.publicKeyHex }
    }
    // First time — generate initial key
    const newPair = await keyring.generateKeyPair()
    return { pubkey: newPair.publicKeyHex }
  }

  async rotateKey(): Promise<{ pubkey: string }> {
    const keyring = await this.getKeyring()
    const newPair = await keyring.generateKeyPair()
    return { pubkey: newPair.publicKeyHex }
  }

  async registerKey(privkey: Uint8Array): Promise<{ pubkey: string }> {
    const keyring = await this.getKeyring()
    const pair = await keyring.addKeyPair(privkey)
    return { pubkey: pair.publicKeyHex }
  }
}
