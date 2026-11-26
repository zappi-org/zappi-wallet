import { decrypt, encrypt } from 'nostr-tools/nip04'
import { hexToBytes } from '@noble/hashes/utils.js'

export function encryptMessage(
  senderSecretHex: string,
  recipientPubkeyHex: string,
  plaintext: string,
): string {
  return encrypt(hexToBytes(senderSecretHex), recipientPubkeyHex, plaintext)
}

export function decryptMessage(
  recipientSecretHex: string,
  senderPubkeyHex: string,
  ciphertext: string,
): string {
  return decrypt(hexToBytes(recipientSecretHex), senderPubkeyHex, ciphertext)
}
