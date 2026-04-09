import type { CryptoUseCase } from '@/core/ports/driving/crypto.usecase'
import type { CryptoGateway } from '@/core/ports/driven/crypto-gateway.port'
import type { POSSubKey } from '@/core/domain/pos-key'

export class CryptoService implements CryptoUseCase {
  constructor(private readonly gateway: CryptoGateway) {}

  encodeNpub(publicKeyHex: string): string {
    return this.gateway.encodeNpub(publicKeyHex)
  }

  encodeNprofile(publicKeyHex: string, relays: string[]): string {
    return this.gateway.encodeNprofile(publicKeyHex, relays)
  }

  decodeNpub(npub: string): { type: string; data: string } {
    return this.gateway.decodeNpub(npub)
  }

  derivePOSSubKey(mnemonic: string, posIndex: number): POSSubKey {
    return this.gateway.derivePOSSubKey(mnemonic, posIndex)
  }

  getP2PKPubkey(privateKey: string): string {
    return this.gateway.getP2PKPubkey(privateKey)
  }
}
