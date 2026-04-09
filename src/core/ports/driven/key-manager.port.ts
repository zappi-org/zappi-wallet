import type { KeyPair, POSSubKey } from '@/core/domain/key-manager'

export interface KeyManager {
  generateMnemonic(strength?: 128 | 256): string
  validateMnemonic(mnemonic: string): boolean
  deriveNostrKeyPair(mnemonic: string): KeyPair
  deriveP2PKPubkey(privateKey: string): string
  derivePOSSubKey(mnemonic: string, index: number): POSSubKey
  deriveBip39Seed(mnemonic: string): Uint8Array
}
