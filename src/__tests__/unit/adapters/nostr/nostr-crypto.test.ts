import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock nostr-tools
vi.mock('nostr-tools', () => ({
  finalizeEvent: vi.fn().mockImplementation((event, _sk) => ({
    ...event,
    id: 'signed-id',
    pubkey: 'signer-pubkey',
    sig: 'signature',
  })),
  verifyEvent: vi.fn().mockReturnValue(true),
  getPublicKey: vi.fn().mockReturnValue('derived-pubkey-hex'),
  nip19: {
    npubEncode: vi.fn().mockReturnValue('npub1encoded'),
    nprofileEncode: vi.fn().mockReturnValue('nprofile1encoded'),
    decode: vi.fn(),
  },
  nip17: {
    wrapEvent: vi.fn().mockReturnValue({
      id: 'wrap-id', kind: 1059, content: 'encrypted',
      tags: [], pubkey: 'ephemeral', sig: 'sig', created_at: 1000,
    }),
    unwrapEvent: vi.fn().mockReturnValue({ content: 'inner-message', pubkey: 'sender-hex' }),
  },
}))

vi.mock('nostr-tools/nip44', () => ({
  v2: {
    utils: { getConversationKey: vi.fn().mockReturnValue(new Uint8Array(32)) },
    encrypt: vi.fn().mockReturnValue('ciphertext'),
    decrypt: vi.fn().mockReturnValue('plaintext'),
  },
}))

vi.mock('@noble/hashes/utils.js', () => ({
  hexToBytes: vi.fn().mockReturnValue(new Uint8Array(32)),
}))

import {
  signEvent,
  verifyEventSignature,
  derivePublicKey,
  npubEncode,
  nprofileEncode,
  getConversationKey,
  encrypt,
  decrypt,
  wrapEvent,
  unwrapEvent,
} from '@/adapters/nostr/internal/nostr-crypto'
import { v2 as nip44v2 } from 'nostr-tools/nip44'

describe('nostr-crypto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(nip44v2.decrypt).mockReturnValue('plaintext')
  })

  // ─── Event signing / verification ───

  describe('signEvent', () => {
    it('signs an unsigned event and returns signed event', () => {
      const unsigned = {
        pubkey: 'my-pubkey',
        created_at: 1000,
        kind: 1,
        tags: [['p', 'recipient']],
        content: 'hello',
      }

      const signed = signEvent(unsigned, 'a'.repeat(64))

      expect(signed.id).toBe('signed-id')
      expect(signed.sig).toBe('signature')
      expect(signed.content).toBe('hello')
      expect(signed.kind).toBe(1)
    })
  })

  describe('verifyEventSignature', () => {
    it('returns true for valid event', () => {
      const event = {
        id: 'test', pubkey: 'pk', created_at: 1, kind: 1,
        tags: [], content: '', sig: 'valid',
      }
      expect(verifyEventSignature(event)).toBe(true)
    })
  })

  // ─── Key derivation ───

  describe('derivePublicKey', () => {
    it('derives public key from private key hex', () => {
      const pubkey = derivePublicKey('a'.repeat(64))
      expect(pubkey).toBe('derived-pubkey-hex')
    })
  })

  // ─── NIP-19 ───

  describe('npubEncode', () => {
    it('encodes hex pubkey to npub', () => {
      expect(npubEncode('abcdef')).toBe('npub1encoded')
    })
  })

  // npubDecode/nprofileDecode tests removed — functions moved to core/domain/nostr-address

  describe('nprofileEncode', () => {
    it('encodes pubkey + relays to nprofile', () => {
      expect(nprofileEncode('pk', ['wss://relay.test'])).toBe('nprofile1encoded')
    })
  })

  // ─── NIP-44 ───

  describe('encrypt / decrypt', () => {
    it('encrypts plaintext', () => {
      const key = getConversationKey('a'.repeat(64), 'b'.repeat(64))
      expect(encrypt('secret', key)).toBe('ciphertext')
    })

    it('decrypts payload', () => {
      const key = getConversationKey('a'.repeat(64), 'b'.repeat(64))
      expect(decrypt('ciphertext', key)).toBe('plaintext')
    })
  })

  // ─── NIP-17 gift wrap ───

  describe('wrapEvent', () => {
    it('creates gift wrapped event', () => {
      const wrapped = wrapEvent('a'.repeat(64), 'b'.repeat(64), 'hello')
      expect(wrapped.kind).toBe(1059)
      expect(wrapped.id).toBe('wrap-id')
    })
  })

  describe('unwrapEvent', () => {
    it('unwraps gift wrapped event', () => {
      const seal = {
        id: 'seal-id',
        pubkey: 'sender-hex',
        created_at: 999,
        kind: 13,
        tags: [],
        content: 'sealed-content',
        sig: 'seal-sig',
      }
      const rumor = {
        id: 'rumor-id',
        pubkey: 'sender-hex',
        created_at: 998,
        kind: 14,
        tags: [],
        content: 'inner-message',
      }
      vi.mocked(nip44v2.decrypt)
        .mockReturnValueOnce(JSON.stringify(seal))
        .mockReturnValueOnce(JSON.stringify(rumor))
      const event = {
        id: 'wrap-id', pubkey: 'ephemeral', created_at: 1000,
        kind: 1059, tags: [], content: 'encrypted', sig: 'sig',
      }
      const result = unwrapEvent(event, 'a'.repeat(64))
      expect(result.content).toBe('inner-message')
      expect(result.sender).toBe('sender-hex')
    })

    it('rejects rumors whose pubkey does not match the seal author', () => {
      const seal = {
        id: 'seal-id',
        pubkey: 'sender-hex',
        created_at: 999,
        kind: 13,
        tags: [],
        content: 'sealed-content',
        sig: 'seal-sig',
      }
      const rumor = {
        id: 'rumor-id',
        pubkey: 'different-sender',
        created_at: 998,
        kind: 14,
        tags: [],
        content: 'inner-message',
      }
      vi.mocked(nip44v2.decrypt)
        .mockReturnValueOnce(JSON.stringify(seal))
        .mockReturnValueOnce(JSON.stringify(rumor))

      expect(() => unwrapEvent({
        id: 'wrap-id', pubkey: 'ephemeral', created_at: 1000,
        kind: 1059, tags: [], content: 'encrypted', sig: 'sig',
      }, 'a'.repeat(64))).toThrow('NIP-17 seal author mismatch')
    })
  })
})
