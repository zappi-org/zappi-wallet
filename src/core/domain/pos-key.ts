/**
 * POS Sub-Key domain type.
 * Used for POS device provisioning.
 */

export interface POSSubKey {
  index: number
  /** hex, 33-byte compressed secp256k1 */
  p2pkPublicKey: string
  /** hex, 32-byte */
  p2pkPrivateKey: string
  /** hex, 32-byte schnorr x-only */
  nostrPublicKey: string
  /** hex, 32-byte */
  nostrPrivateKey: string
}
