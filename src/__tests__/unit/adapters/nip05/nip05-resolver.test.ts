import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Nip05ResolverAdapter } from '@/adapters/nip05/nip05-resolver'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('Nip05ResolverAdapter', () => {
  let resolver: Nip05ResolverAdapter

  beforeEach(() => {
    vi.clearAllMocks()
    resolver = new Nip05ResolverAdapter()
  })

  it('resolves valid NIP-05 address', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        names: { alice: 'pubkey-hex-alice' },
        relays: { 'pubkey-hex-alice': ['wss://relay1.test', 'wss://relay2.test'] },
      }),
    })

    const result = await resolver.resolve('alice@domain.test')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://domain.test/.well-known/nostr.json?name=alice',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    )
    expect(result).toEqual({
      pubkey: 'pubkey-hex-alice',
      relays: ['wss://relay1.test', 'wss://relay2.test'],
    })
  })

  it('returns empty relays when no relays field', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        names: { bob: 'pubkey-hex-bob' },
      }),
    })

    const result = await resolver.resolve('bob@domain.test')

    expect(result).toEqual({
      pubkey: 'pubkey-hex-bob',
      relays: [],
    })
  })

  it('returns null for unknown name', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        names: { alice: 'pubkey-hex-alice' },
      }),
    })

    const result = await resolver.resolve('unknown@domain.test')
    expect(result).toBeNull()
  })

  it('returns null for HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false })

    const result = await resolver.resolve('alice@domain.test')
    expect(result).toBeNull()
  })

  it('returns null for network error', async () => {
    mockFetch.mockRejectedValue(new Error('network error'))

    const result = await resolver.resolve('alice@domain.test')
    expect(result).toBeNull()
  })

  it('returns null for invalid address format', async () => {
    expect(await resolver.resolve('no-at-sign')).toBeNull()
    expect(await resolver.resolve('@domain.test')).toBeNull()
    expect(await resolver.resolve('name@')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('encodes name in URL', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ names: { 'special user': 'pk' } }),
    })

    await resolver.resolve('special user@domain.test')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://domain.test/.well-known/nostr.json?name=special%20user',
      expect.anything(),
    )
  })
})
