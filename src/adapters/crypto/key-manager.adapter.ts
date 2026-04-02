/**
 * KeyManagerAdapter — @scure/bip39, @scure/bip32, @noble/secp256k1 래핑
 *
 * 외부 라이브러리를 이 파일에 격리.
 */

import * as bip39 from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from '@scure/bip32'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import * as secp256k1 from '@noble/secp256k1'
import type { KeyManager } from '@/core/ports/driven/key-manager.port'
import type { KeyPair, POSSubKey } from '@/core/domain/key-manager'

const NOSTR_DERIVATION_PATH = "m/44'/1237'/0'/0/0"
const POS_PURPOSE = 129372

export class KeyManagerAdapter implements KeyManager {
  generateMnemonic(strength: 128 | 256 = 128): string {
    return bip39.generateMnemonic(wordlist, strength)
  }

  validateMnemonic(mnemonic: string): boolean {
    return bip39.validateMnemonic(mnemonic, wordlist)
  }

  deriveNostrKeyPair(mnemonic: string): KeyPair {
    const seed = bip39.mnemonicToSeedSync(mnemonic)
    const hdKey = HDKey.fromMasterSeed(seed)
    const derived = hdKey.derive(NOSTR_DERIVATION_PATH)

    if (!derived.privateKey) {
      throw new Error('Failed to derive private key')
    }

    const privateKey = bytesToHex(derived.privateKey)
    const publicKey = bytesToHex(derived.publicKey!.slice(1))

    return { privateKey, publicKey }
  }

  deriveP2PKPubkey(privateKey: string): string {
    const privKeyBytes = hexToBytes(privateKey)
    const compressedPubkey = secp256k1.getPublicKey(privKeyBytes, true)
    return bytesToHex(compressedPubkey)
  }

  derivePOSSubKey(mnemonic: string, index: number): POSSubKey {
    const seed = bip39.mnemonicToSeedSync(mnemonic)
    const master = HDKey.fromMasterSeed(seed)
    const base = master.derive(`m/${POS_PURPOSE}'/0'/${index}'`)

    const p2pkChild = base.deriveChild(0)
    if (!p2pkChild.privateKey) {
      throw new Error('Failed to derive P2PK key for POS')
    }
    const p2pkPublicKey = bytesToHex(secp256k1.getPublicKey(p2pkChild.privateKey, true))
    const p2pkPrivateKey = bytesToHex(p2pkChild.privateKey)

    const nostrChild = base.deriveChild(1)
    if (!nostrChild.privateKey) {
      throw new Error('Failed to derive Nostr key for POS')
    }
    const nostrPublicKey = bytesToHex(nostrChild.publicKey!.slice(1))
    const nostrPrivateKey = bytesToHex(nostrChild.privateKey)

    return { index, p2pkPublicKey, p2pkPrivateKey, nostrPublicKey, nostrPrivateKey }
  }

  deriveBip39Seed(mnemonic: string): Uint8Array {
    return bip39.mnemonicToSeedSync(mnemonic)
  }
}
