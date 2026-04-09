import { describe, it, expect } from 'vitest'
import { KeyManagerAdapter } from '@/adapters/crypto/key-manager.adapter'

const adapter = new KeyManagerAdapter()

// BIP-39 test vector — "abandon" x11 + "about"
const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('KeyManagerAdapter', () => {
  describe('generateMnemonic', () => {
    it('generates 12-word mnemonic by default', () => {
      const mnemonic = adapter.generateMnemonic()
      expect(mnemonic.split(' ')).toHaveLength(12)
      expect(adapter.validateMnemonic(mnemonic)).toBe(true)
    })

    it('generates 24-word mnemonic with strength 256', () => {
      const mnemonic = adapter.generateMnemonic(256)
      expect(mnemonic.split(' ')).toHaveLength(24)
      expect(adapter.validateMnemonic(mnemonic)).toBe(true)
    })
  })

  describe('validateMnemonic', () => {
    it('validates correct mnemonic', () => {
      expect(adapter.validateMnemonic(TEST_MNEMONIC)).toBe(true)
    })

    it('rejects invalid mnemonic', () => {
      expect(adapter.validateMnemonic('invalid words here')).toBe(false)
    })
  })

  describe('deriveNostrKeyPair', () => {
    it('derives NIP-06 keypair matching crypto.ts output', () => {
      const kp = adapter.deriveNostrKeyPair(TEST_MNEMONIC)
      expect(kp.privateKey).toBe('5f29af3b9676180290e77a4efad265c4c2ff28a5302461f73597fda26bb25731')
      expect(kp.publicKey).toBe('e8bcf3823669444d0b49ad45d65088635d9fd8500a75b5f20b59abefa56a144f')
    })
  })

  describe('deriveP2PKPubkey', () => {
    it('derives compressed pubkey matching crypto.ts output', () => {
      const kp = adapter.deriveNostrKeyPair(TEST_MNEMONIC)
      const p2pk = adapter.deriveP2PKPubkey(kp.privateKey)
      expect(p2pk).toBe('02e8bcf3823669444d0b49ad45d65088635d9fd8500a75b5f20b59abefa56a144f')
    })
  })

  describe('derivePOSSubKey', () => {
    it('derives POS keypairs matching crypto.ts output', () => {
      const pos = adapter.derivePOSSubKey(TEST_MNEMONIC, 0)
      expect(pos.index).toBe(0)
      expect(pos.p2pkPublicKey).toBe('035f15aeac7645180ac56740ff6b4f471b55fde54d40e5a1ab07716807323a585c')
      expect(pos.p2pkPrivateKey).toBe('adcbd35611e5a5af8d9b632445ed4b06e6dfc6693c9b419856da6337c4a6745e')
      expect(pos.nostrPublicKey).toBe('0888521cb506359734a7c63574f6c866da3dd98e30e8aef6c7bda22dcd76ba6f')
      expect(pos.nostrPrivateKey).toBe('9b6db523f8beae9d3c33a9b6093e86afb91461226a5670df43ebb0b41d32563f')
    })

    it('derives different keys for different indices', () => {
      const pos0 = adapter.derivePOSSubKey(TEST_MNEMONIC, 0)
      const pos1 = adapter.derivePOSSubKey(TEST_MNEMONIC, 1)
      expect(pos0.p2pkPublicKey).not.toBe(pos1.p2pkPublicKey)
      expect(pos0.nostrPublicKey).not.toBe(pos1.nostrPublicKey)
    })
  })

  describe('deriveBip39Seed', () => {
    it('returns 64-byte Uint8Array', () => {
      const seed = adapter.deriveBip39Seed(TEST_MNEMONIC)
      expect(seed).toBeInstanceOf(Uint8Array)
      expect(seed.length).toBe(64)
    })

    it('is deterministic', () => {
      const seed1 = adapter.deriveBip39Seed(TEST_MNEMONIC)
      const seed2 = adapter.deriveBip39Seed(TEST_MNEMONIC)
      expect(seed1).toEqual(seed2)
    })

    it('differs from SHA256(nostr privkey) — bug fix verification', () => {
      const seed = adapter.deriveBip39Seed(TEST_MNEMONIC)
      const kp = adapter.deriveNostrKeyPair(TEST_MNEMONIC)
      // BIP-39 seed는 nostr privkey와 무관해야 함
      const seedHex = Array.from(seed).map(b => b.toString(16).padStart(2, '0')).join('')
      expect(seedHex).not.toContain(kp.privateKey)
    })
  })
})
