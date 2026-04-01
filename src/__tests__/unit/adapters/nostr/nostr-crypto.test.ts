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
  npubDecode,
  nprofileEncode,
  nprofileDecode,
  getConversationKey,
  encrypt,
  decrypt,
  wrapEvent,
  unwrapEvent,
} from '@/adapters/nostr/internal/nostr-crypto'

import { nip19 } from 'nostr-tools'

describe('nostr-crypto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  describe('npubDecode', () => {
    it('decodes npub to hex', () => {
      vi.mocked(nip19.decode).mockReturnValue({ type: 'npub', data: 'decoded-hex' } as ReturnType<typeof nip19.decode>)
      expect(npubDecode('npub1test')).toBe('decoded-hex')
    })

    it('throws on non-npub input', () => {
      vi.mocked(nip19.decode).mockReturnValue({ type: 'nprofile', data: { pubkey: 'x' } } as ReturnType<typeof nip19.decode>)
      expect(() => npubDecode('nprofile1test')).toThrow('Expected npub')
    })
  })

  describe('nprofileEncode', () => {
    it('encodes pubkey + relays to nprofile', () => {
      expect(nprofileEncode('pk', ['wss://relay.test'])).toBe('nprofile1encoded')
    })
  })

  describe('nprofileDecode', () => {
    it('decodes nprofile to pubkey + relays', () => {
      vi.mocked(nip19.decode).mockReturnValue({
        type: 'nprofile',
        data: { pubkey: 'pk-hex', relays: ['wss://r.test'] },
      } as ReturnType<typeof nip19.decode>)
      const result = nprofileDecode('nprofile1test')
      expect(result.pubkey).toBe('pk-hex')
      expect(result.relays).toEqual(['wss://r.test'])
    })

    it('throws on non-nprofile input', () => {
      vi.mocked(nip19.decode).mockReturnValue({ type: 'npub', data: 'x' } as ReturnType<typeof nip19.decode>)
      expect(() => nprofileDecode('npub1test')).toThrow('Expected nprofile')
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
      const event = {
        id: 'wrap-id', pubkey: 'ephemeral', created_at: 1000,
        kind: 1059, tags: [], content: 'encrypted', sig: 'sig',
      }
      const result = unwrapEvent(event, 'a'.repeat(64))
      expect(result.content).toBe('inner-message')
      expect(result.sender).toBe('sender-hex')
    })
  })
})
