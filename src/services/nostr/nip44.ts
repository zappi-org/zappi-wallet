import * as nip44 from 'nostr-tools/nip44'
import { hexToBytes } from '@noble/hashes/utils.js'

/**
 * NIP-44 v2 encryption/decryption wrapper using nostr-tools
 * https://github.com/nostr-protocol/nips/blob/master/44.md
 */

/**
 * Get conversation key from sender/receiver key pair
 */
export function getConversationKeyFromKeys(
  privateKeyHex: string,
  publicKeyHex: string
): Uint8Array {
  const privateKey = hexToBytes(privateKeyHex)
  return nip44.v2.utils.getConversationKey(privateKey, publicKeyHex)
}

/**
 * Encrypt a message using NIP-44
 */
export function encrypt(
  plaintext: string,
  conversationKey: Uint8Array,
  nonce?: Uint8Array
): string {
  return nip44.v2.encrypt(plaintext, conversationKey, nonce)
}

/**
 * Decrypt a message using NIP-44
 */
export function decrypt(
  payload: string,
  conversationKey: Uint8Array
): string {
  return nip44.v2.decrypt(payload, conversationKey)
}

/**
 * Decrypt using private key and sender's public key
 */
export function decryptWithKeys(
  payload: string,
  privateKeyHex: string,
  senderPublicKeyHex: string
): string {
  const conversationKey = getConversationKeyFromKeys(privateKeyHex, senderPublicKeyHex)
  return decrypt(payload, conversationKey)
}
