import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NpubcashAdapter } from '@/adapters/npubcash/npubcash.adapter'
import { NpubcashApiError } from '@/core/errors/npubcash'
import type { NostrSigner } from '@/core/ports/driven/nostr-signer.port'

const BASE_URL = 'http://localhost:8000'
const MOCK_JWT = 'header.payload.signature'
const MOCK_PUBKEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const MOCK_NIP98 = 'base64EncodedNip98Event'

function createMockSigner(): NostrSigner {
  return {
    createNip98Token: vi.fn().mockReturnValue(MOCK_NIP98),
    getPublicKey: vi.fn().mockReturnValue(MOCK_PUBKEY),
    getNpub: vi.fn().mockReturnValue('npub1mock'),
  }
}

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('NpubcashAdapter', () => {
  let adapter: NpubcashAdapter
  let signer: NostrSigner

  beforeEach(() => {
    vi.clearAllMocks()
    adapter = new NpubcashAdapter(BASE_URL)
    signer = createMockSigner()
  })

  // ── setBaseUrl ──

  it('setBaseUrl updates the URL and clears JWT cache', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: false, data: { token: MOCK_JWT } }),
    })

    await adapter.authenticate(signer)

    adapter.setBaseUrl('https://other.example.com')

    expect(adapter['jwtCache'].size).toBe(0)
  })

  // ── authenticate ──

  it('authenticate sends NIP-98 token and returns a session', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: false, data: { token: MOCK_JWT } }),
    })

    const result = await adapter.authenticate(signer)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.token).toBe(MOCK_JWT)
      expect(result.value.expiresAt).toBeGreaterThan(Date.now())
    }

    expect(signer.createNip98Token).toHaveBeenCalledWith(
      `${BASE_URL}/api/v2/auth/nip98`,
      'GET',
    )
    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v2/auth/nip98`,
      expect.objectContaining({
        headers: { Authorization: `Nostr ${MOCK_NIP98}` },
      }),
    )
  })

  it('authenticate caches JWT for the same pubkey', async () => {
    let callCount = 0
    mockFetch.mockImplementation(() => {
      callCount++
      return Promise.resolve({
        ok: true,
        json: async () => ({ error: false, data: { token: `${MOCK_JWT}_${callCount}` } }),
      })
    })

    const r1 = await adapter.authenticate(signer)
    const r2 = await adapter.authenticate(signer)

    expect(callCount).toBe(1)
    expect(r1.value.token).toBe(r2.value.token)
  })

  it('authenticate returns error on HTTP failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: true, message: 'Unauthorized' }),
    })

    const result = await adapter.authenticate(signer)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NpubcashApiError)
    }
  })

  it('authenticate returns error on network failure', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const result = await adapter.authenticate(signer)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NpubcashApiError)
    }
  })

  // ── getAccountInfo ──

  it('getAccountInfo fetches with Bearer token', async () => {
    const user = { name: 'alice', mintUrl: 'https://mint.example.com', lockQuote: false }
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { token: MOCK_JWT } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { user } }) })

    const session = await adapter.authenticate(signer)
    const result = await adapter.getAccountInfo(session.value)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.alias).toBe('alice')
      expect(result.value.mintUrl).toBe('https://mint.example.com')
      expect(result.value.lockQuote).toBe(false)
    }

    expect(mockFetch).toHaveBeenCalledWith(
      `${BASE_URL}/api/v2/user/info`,
      expect.objectContaining({
        headers: { Authorization: `Bearer ${MOCK_JWT}` },
      }),
    )
  })

  // ── purchaseAlias ──

  it('purchaseAlias sends username and cashu token', async () => {
    const user = { name: 'bob', pubkey: 'npub1...' }
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { token: MOCK_JWT } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { user } }) })

    const session = await adapter.authenticate(signer)
    const result = await adapter.purchaseAlias(session.value, 'bob', 'cashuToken123')

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.alias).toBe('bob')
      expect(result.value.npub).toBe('npub1...')
    }

    expect(mockFetch).toHaveBeenLastCalledWith(
      `${BASE_URL}/api/v2/user/username`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${MOCK_JWT}`,
          'X-Cashu': 'cashuToken123',
        }),
        body: JSON.stringify({ username: 'bob' }),
      }),
    )
  })

  it('purchaseAlias omits X-Cashu header when cashuToken is empty', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { token: MOCK_JWT } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { user: { name: 'bob', pubkey: 'npub1...' } } }) })

    const session = await adapter.authenticate(signer)
    await adapter.purchaseAlias(session.value, 'bob', '')

    const headers = (mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Cashu']).toBeUndefined()
  })

  // ── setPreferredMint ──

  it('setPreferredMint sends PATCH with mintUrl', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { token: MOCK_JWT } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: {} }) })

    const session = await adapter.authenticate(signer)
    const result = await adapter.setPreferredMint(session.value, 'https://mint.example.com')

    expect(result.ok).toBe(true)

    expect(mockFetch).toHaveBeenLastCalledWith(
      `${BASE_URL}/api/v2/user/mint`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ mint_url: 'https://mint.example.com' }),
      }),
    )
  })

  // ── toggleLock ──

  it('toggleLock sends PATCH and returns toggled lockQuote state', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { token: MOCK_JWT } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { user: { name: null, mintUrl: 'https://mint.example.com', lockQuote: false } } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: {} }) })

    const session = await adapter.authenticate(signer)
    const result = await adapter.toggleLock(session.value)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe(true)
    }

    expect(mockFetch).toHaveBeenLastCalledWith(
      `${BASE_URL}/api/v2/user/lock`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ lockQuotes: true }),
      }),
    )
  })

  // ── getPaidQuotes ──

  it('getPaidQuotes returns quote list', async () => {
    const quotes = [
      { quoteId: 'q1', amount: 1000, mintUrl: 'https://mint.example.com', unit: 'sat', paidAt: 100, expiry: 200 },
    ]
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { token: MOCK_JWT } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { quotes } }) })

    const session = await adapter.authenticate(signer)
    const result = await adapter.getPaidQuotes(session.value)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual(quotes)
    }

    expect(mockFetch).toHaveBeenLastCalledWith(
      `${BASE_URL}/api/v2/wallet/quotes`,
      expect.objectContaining({ headers: { Authorization: `Bearer ${MOCK_JWT}` } }),
    )
  })

  it('getPaidQuotes accepts since parameter', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { token: MOCK_JWT } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { quotes: [] } }) })

    const session = await adapter.authenticate(signer)
    await adapter.getPaidQuotes(session.value, 1000)

    expect(mockFetch).toHaveBeenLastCalledWith(
      `${BASE_URL}/api/v2/wallet/quotes?since=1000`,
      expect.any(Object),
    )
  })
})
