import type { POSSubKey } from '@/core/domain/pos-key'

export interface CryptoUseCase {
  encodeNpub(publicKeyHex: string): string
  encodeNprofile(publicKeyHex: string, relays: string[]): string
  decodeNpub(npub: string): { type: string; data: string }
  derivePOSSubKey(mnemonic: string, posIndex: number): POSSubKey
  getP2PKPubkey(privateKey: string): string
}
