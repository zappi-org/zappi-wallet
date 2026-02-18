import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { Nip05Service } from '@/services/nip05/nip05.service'

// Mock fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('Nip05Service', () => {
  let service: Nip05Service

  beforeEach(() => {
    service = new Nip05Service()
    mockFetch.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('lookup', () => {
    it('should lookup NIP-05 identifier', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          names: { user: 'pubkey123' },
          relays: { pubkey123: ['wss://relay1.com', 'wss://relay2.com'] },
        }),
      })

      const result = await service.lookup('user@example.com')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.pubkey).toBe('pubkey123')
        expect(result.value.relays).toContain('wss://relay1.com')
      }
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.com/.well-known/nostr.json?name=user',
        expect.any(Object)
      )
    })

    it('should handle identifier without name (underscore)', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          names: { _: 'root-pubkey' },
          relays: { 'root-pubkey': ['wss://relay.com'] },
        }),
      })

      const result = await service.lookup('_@example.com')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.pubkey).toBe('root-pubkey')
      }
    })

    it('should return error for non-existent user', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          names: { other: 'pubkey' },
        }),
      })

      const result = await service.lookup('nonexistent@example.com')

      expect(result.isErr()).toBe(true)
    })

    it('should return error for network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'))

      const result = await service.lookup('user@example.com')

      expect(result.isErr()).toBe(true)
    })

    it('should return error for invalid response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      })

      const result = await service.lookup('user@example.com')

      expect(result.isErr()).toBe(true)
    })

    it('should return empty relays if not provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          names: { user: 'pubkey123' },
        }),
      })

      const result = await service.lookup('user@example.com')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.relays).toEqual([])
      }
    })
  })

  describe('lookupRelaysOnly', () => {
    it('should lookup only relays from domain', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          names: { _: 'pubkey' },
          relays: { pubkey: ['wss://relay1.com'] },
        }),
      })

      const result = await service.lookupRelaysOnly('example.com')

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toContain('wss://relay1.com')
      }
    })
  })

  describe('parseIdentifier', () => {
    it('should parse standard identifier', () => {
      const result = service.parseIdentifier('user@example.com')

      expect(result).toEqual({ name: 'user', domain: 'example.com' })
    })

    it('should handle underscore identifier', () => {
      const result = service.parseIdentifier('_@example.com')

      expect(result).toEqual({ name: '_', domain: 'example.com' })
    })

    it('should return null for invalid identifier', () => {
      expect(service.parseIdentifier('invalid')).toBeNull()
      expect(service.parseIdentifier('@nodomain')).toBeNull()
      expect(service.parseIdentifier('noat.com')).toBeNull()
    })
  })

  describe('buildNip05Url', () => {
    it('should build correct URL', () => {
      const url = service.buildNip05Url('example.com', 'user')

      expect(url).toBe('https://example.com/.well-known/nostr.json?name=user')
    })

    it('should handle underscore name', () => {
      const url = service.buildNip05Url('example.com', '_')

      expect(url).toBe('https://example.com/.well-known/nostr.json?name=_')
    })
  })
})
