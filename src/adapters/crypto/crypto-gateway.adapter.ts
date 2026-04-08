import { nip19 } from 'nostr-tools'
import { HDKey } from '@scure/bip32'
import * as bip39 from '@scure/bip39'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as secp256k1 from '@noble/secp256k1'
import type { CryptoGateway } from '@/core/ports/driven/crypto-gateway.port'
import type { POSSubKey } from '@/core/domain/pos-key'

const NIP06_DERIVATION_PATH = "m/44'/1237'/0'"

export class CryptoGatewayAdapter implements CryptoGateway {
  encodeNpub(publicKeyHex: string): string {
    return nip19.npubEncode(publicKeyHex)
  }

  encodeNprofile(publicKeyHex: string, relays: string[]): string {
    return nip19.nprofileEncode({ pubkey: publicKeyHex, relays })
  }

  decodeNpub(npub: string): { type: string; data: string } {
    const decoded = nip19.decode(npub)
    return { type: decoded.type, data: decoded.data as string }
  }

  derivePOSSubKey(mnemonic: string, posIndex: number): POSSubKey {
    const seed = bip39.mnemonicToSeedSync(mnemonic)
    const root = HDKey.fromMasterSeed(seed)

    const p2pkPath = `${NIP06_DERIVATION_PATH}/100'/${posIndex}'`
    const p2pkChild = root.derive(p2pkPath)
    if (!p2pkChild.privateKey) throw new Error('P2PK key derivation failed')

    const p2pkPrivHex = bytesToHex(p2pkChild.privateKey)
    const p2pkPubCompressed = secp256k1.getPublicKey(p2pkChild.privateKey, true)
    const p2pkPubHex = bytesToHex(p2pkPubCompressed)

    const nostrPath = `${NIP06_DERIVATION_PATH}/101'/${posIndex}'`
    const nostrChild = root.derive(nostrPath)
    if (!nostrChild.privateKey) throw new Error('Nostr key derivation failed')

    const nostrPrivHex = bytesToHex(nostrChild.privateKey)
    const nostrPubUncompressed = secp256k1.getPublicKey(nostrChild.privateKey, false)
    const nostrPubHex = bytesToHex(nostrPubUncompressed.slice(1, 33))

    return {
      index: posIndex,
      p2pkPublicKey: p2pkPubHex,
      p2pkPrivateKey: p2pkPrivHex,
      nostrPublicKey: nostrPubHex,
      nostrPrivateKey: nostrPrivHex,
    }
  }

  getP2PKPubkey(privateKey: string): string {
    const privBytes = hexToBytes(privateKey)
    const pubkey = secp256k1.getPublicKey(privBytes, true)
    return bytesToHex(pubkey)
  }
}
