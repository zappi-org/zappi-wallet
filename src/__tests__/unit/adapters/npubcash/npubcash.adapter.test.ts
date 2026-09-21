import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NpubcashAdapter, isAllowedChallenge } from '@/adapters/npubcash/npubcash.adapter'
import { NpubcashApiError, NpubcashUsernameTakenError } from '@/core/errors/npubcash'
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


class MockWebSocket {
  static instance: MockWebSocket[] = []
  readyState = 1
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  sent: string[] = []
  constructor(public url: string) {
    MockWebSocket.instance.push(this)
  }
  close() { this.onclose?.() }
  send(data: string) { this.sent.push(data) }
}
vi.stubGlobal('WebSocket', MockWebSocket)


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
    if (!r1.ok || !r2.ok) throw new Error('expected auth success')

    expect(callCount).toBe(1)
    expect(r1.value.token).toBe(r2.value.token)
  })

  it('clears the JWT cache when an authed call gets 401, so the next authenticate mints fresh', async () => {
    let callCount = 0
    mockFetch.mockImplementation(() => {
      callCount++
      return Promise.resolve({
        ok: true,
        json: async () => ({ error: false, data: { token: `${MOCK_JWT}_${callCount}` } }),
      })
    })
    const session = await adapter.authenticate(signer)
    if (!session.ok) throw new Error('expected auth success')
    expect(callCount).toBe(1)

    // authed endpoint rejects the cached token with 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: async () => ({ error: true, message: 'token expired' }),
    })
    const rejected = await adapter.getPaidQuotes(session.value)
    expect(rejected.ok).toBe(false)

    // cache gone → authenticate issues a new token instead of reusing the rejected one
    const fresh = await adapter.authenticate(signer)
    if (!fresh.ok) throw new Error('expected auth success')
    expect(fresh.value.token).not.toBe(session.value.token)
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
    if (!session.ok) throw new Error('expected auth success')
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
    if (!session.ok) throw new Error('expected auth success')
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
    if (!session.ok) throw new Error('expected auth success')
    await adapter.purchaseAlias(session.value, 'bob', '')

    const headers = (mockFetch.mock.calls[1][1] as RequestInit).headers as Record<string, string>
    expect(headers['X-Cashu']).toBeUndefined()
  })

  it('purchaseAlias maps HTTP 409 to NpubcashUsernameTakenError (fallback path)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { token: MOCK_JWT } }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: true, message: 'username already taken (HTTP 409)' }) })

    const session = await adapter.authenticate(signer)
    if (!session.ok) throw new Error('expected auth success')
    const result = await adapter.purchaseAlias(session.value, 'bob', '')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NpubcashUsernameTakenError)
      expect((result.error as { code?: string }).code).toBe('NPUBCASH_USERNAME_TAKEN')
    }
  })

  it('purchaseAlias maps HTTP 409 to NpubcashUsernameTakenError (token path)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { token: MOCK_JWT } }) })
      .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: true, message: 'username already taken (HTTP 409)' }) })

    const session = await adapter.authenticate(signer)
    if (!session.ok) throw new Error('expected auth success')
    const result = await adapter.purchaseAlias(session.value, 'bob', 'cashuToken123')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(NpubcashUsernameTakenError)
      expect((result.error as { code?: string }).code).toBe('NPUBCASH_USERNAME_TAKEN')
    }
  })


  // ── setPreferredMint ──

  it('setPreferredMint sends PATCH with mintUrl', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: { token: MOCK_JWT } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ error: false, data: {} }) })

    const session = await adapter.authenticate(signer)
    if (!session.ok) throw new Error('expected auth success')
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
    if (!session.ok) throw new Error('expected auth success')
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
    if (!session.ok) throw new Error('expected auth success')
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
    if (!session.ok) throw new Error('expected auth success')
    await adapter.getPaidQuotes(session.value, 1000)

    expect(mockFetch).toHaveBeenLastCalledWith(
      `${BASE_URL}/api/v2/wallet/quotes?since=1000`,
      expect.any(Object),
    )
  })

})

// isAllowedChallenge

describe('isAllowedChallenge', () => {
  it('false if external domain', () => {
    expect(isAllowedChallenge(
      'https://evil.example.com/api/v2/ws/quote', 'GET',
      'http://localhost:8080', '/api/v2/ws/quote',
    )).toBe(false)
  })

  it('True if SameDomain + correct path + GET', () => {
    expect(isAllowedChallenge(
      'http://localhost:8000/api/v2/ws/quote', // url from challenge
      'GET',
      'http://localhost:8000',
      '/api/v2/ws/quote',
    )).toBe(true)
  })

  it('reject POST method', () => {
    expect(isAllowedChallenge(
      'https://example.com/api/v2/ws/quote', 'POST',
      'https://example.com',
      '/api/v2/ws/quote'
    )).toBe(false)
  })

  //케이스 4
  it('False if different path with same domain', () => {
    expect(isAllowedChallenge(
      'https://example.com/api/v2/user/info', 'GET',
      'https://example.com',
      '/api/v2/ws/quote'
      )).toBe(false)
    })

  it('treat ws url as baseUrl', () => {
    expect(isAllowedChallenge(
      'ws://example.com/api/v2/ws/quote', 'GET',
      'http://example.com',
      '/api/v2/ws/quote'
    )).toBe(true)
  })

  it('if relative path comes, match with baseUrl and pass', () => {
    expect(isAllowedChallenge(
      '/api/v2/ws/quote', 'GET',
      'https://example.com',
      '/api/v2/ws/quote',
    )).toBe(true)
  })

  it('False if broken URL or undefined', () => {
    expect(isAllowedChallenge(
      'https://ex ample.com', 'GET',
      'https://example.com',
      '/api/v2/ws/quote'
    )).toBe(false)
  })
})

describe('subscribePaidQuotes challenge gate', () => {
  let adapter: NpubcashAdapter
  let signer: NostrSigner

  beforeEach(() => {
    vi.clearAllMocks()
    MockWebSocket.instance = []
    adapter = new NpubcashAdapter(BASE_URL)
    signer = createMockSigner()
  })

  const subscribe = async () => {
    const result = await adapter.subscribePaidQuotes(signer, vi.fn())
    expect(result.ok).toBe(true)
    return MockWebSocket.instance[0]
  }

  const sendToWs = (ws: MockWebSocket, payload: unknown) =>
    ws.onmessage?.({data:JSON.stringify(payload)})

  it('do not sign extern url challenge', async () => {
    const ws = await subscribe()

    sendToWs(ws,{ type: 'challenge', payload: {
      url: 'https://evil.example.com/api/v2/ws/quote', method: 'GET'
    }
    })
    expect(signer.createNip98Token).not.toHaveBeenCalled()
    expect(ws.sent).toEqual([])
  })


  it('sign valid challenge', async() => {
    const ws = await subscribe()
    const url = `${BASE_URL}/api/v2/ws/quote`

    sendToWs(ws, { type: 'challenge', payload: { url, method: 'GET' } })

    expect(signer.createNip98Token).toHaveBeenCalledWith(url, 'GET')
    expect(ws.sent).toEqual([JSON.stringify({ type: 'challenge-response', payload: `Nostr ${MOCK_NIP98}` })])
  })

  it('stil sign valid challenge after deny once', async () => {
    const ws = await subscribe()

    sendToWs(ws, {
      type: 'challenge', payload: {
        url: 'https://evil.example.com/api/v2/ws/quote', method: 'GET'
      }
    })

    sendToWs(ws, {
      type: 'challenge', payload: {
        url: `${BASE_URL}/api/v2/ws/quote`, method: 'GET'
      }
    })

    expect(signer.createNip98Token).toHaveBeenCalledTimes(1)
    expect(signer.createNip98Token).toHaveBeenLastCalledWith(`${BASE_URL}/api/v2/ws/quote`, 'GET')


  })

})
