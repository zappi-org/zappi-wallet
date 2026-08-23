import { describe, it, expect } from 'vitest'
import { Secp256k1NostrSignerAdapter } from '@/adapters/crypto/secp256k1-nostr-signer'
import { verifyEventSignature } from '@/adapters/nostr/internal/nostr-crypto'
import type { NostrEvent } from '@/core/domain/nostr'

// secp256k1 private key = 1 (generator point G). Canonical test vector.
const PRIVKEY = '00'.repeat(31) + '01'
const EXPECTED_PUBKEY = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'
const EXPECTED_NPUB = 'npub10xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqpkge6d'

const NIP98_KIND = 27235

describe('Secp256k1NostrSignerAdapter', () => {
  describe('getPublicKey', () => {
    it('derives the expected pubkey from a known private key', () => {
      const signer = new Secp256k1NostrSignerAdapter(PRIVKEY)

      expect(signer.getPublicKey()).toBe(EXPECTED_PUBKEY)
    })

    it('returns the same value across calls (cached)', () => {
      const signer = new Secp256k1NostrSignerAdapter(PRIVKEY)

      expect(signer.getPublicKey()).toBe(signer.getPublicKey())
    })
  })

  describe('getNpub', () => {
    it('returns the bech32-encoded npub', () => {
      const signer = new Secp256k1NostrSignerAdapter(PRIVKEY)

      expect(signer.getNpub()).toBe(EXPECTED_NPUB)
    })
  })

  describe('createNip98Token', () => {
    it('produces a valid signed NIP-98 event encoded in base64', () => {
      const signer = new Secp256k1NostrSignerAdapter(PRIVKEY)
      const url = 'https://npub.cash/api/v2/auth/nip98'

      const token = signer.createNip98Token(url, 'GET')
      const event = JSON.parse(atob(token)) as NostrEvent

      expect(event.kind).toBe(NIP98_KIND)
      expect(event.content).toBe('')
      expect(event.tags).toEqual([
        ['u', url],
        ['method', 'GET'],
      ])
      expect(event.pubkey).toBe(EXPECTED_PUBKEY)
      expect(verifyEventSignature(event)).toBe(true)
    })

    it('uppercases the method tag', () => {
      const signer = new Secp256k1NostrSignerAdapter(PRIVKEY)

      const event = JSON.parse(atob(signer.createNip98Token('https://npub.cash/api', 'post'))) as NostrEvent

      expect(event.tags).toContainEqual(['method', 'POST'])
    })
  })

  describe('invalid private key', () => {
    it('throws on a non-hex private key', () => {
      const signer = new Secp256k1NostrSignerAdapter('not-a-hex-key')

      expect(() => signer.getPublicKey()).toThrow()
    })

    it('throws on a zero scalar (out of range)', () => {
      const signer = new Secp256k1NostrSignerAdapter('00'.repeat(32))

      expect(() => signer.getPublicKey()).toThrow()
    })
  })
})
