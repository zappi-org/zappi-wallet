/**
 * key-manager — 키 관리 도메인 타입
 */

export interface KeyPair {
  privateKey: string  // hex, 32-byte
  publicKey: string   // hex, 32-byte x-only (schnorr, 02 prefix 없음)
}

export interface POSSubKey {
  index: number
  p2pkPublicKey: string   // hex, 33-byte compressed secp256k1
  p2pkPrivateKey: string  // hex, 32-byte
  nostrPublicKey: string  // hex, 32-byte schnorr x-only
  nostrPrivateKey: string // hex, 32-byte
}
