/**
 * DirectLnurlAdapter — sat → msat conversion safety net.
 *
 * Pinned contracts:
 * - fetchInvoice: amountSats * 1000 via Math.floor — never inflates the requested amount
 * - min/maxSendable(msat) bounds are inclusive; out-of-range throws before any network request
 * - comment is only sent within the commentAllowed length
 * - resolvePay: Lightning Address format validation + well-known path assembly
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DirectLnurlAdapter } from '@/adapters/lnurl/direct-lnurl.adapter'
import type { LnurlPayParams } from '@/core/ports/driven/lnurl-gateway.port'

const fetchMock = vi.fn()

function jsonResponse(data: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => data }
}

const PAY_PARAMS: LnurlPayParams = {
  callback: 'https://ln.example.com/cb',
  minSendable: 1_000, // 1 sat
  maxSendable: 500_000_000, // 500,000 sats
  metadata: '[["text/plain","test"]]',
  commentAllowed: 20,
  tag: 'payRequest',
  domain: 'ln.example.com',
}

describe('DirectLnurlAdapter', () => {
  const adapter = new DirectLnurlAdapter()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    // 'dummy-pr' isn't valid bolt11, so description_hash verification is skipped
    // (verifyDescriptionHash intentionally ignores decode failures — only a hash mismatch throws)
    fetchMock.mockReset().mockResolvedValue(jsonResponse({ pr: 'dummy-pr' }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function requestedUrl(): URL {
    return new URL(fetchMock.mock.calls[0][0] as string)
  }

  // ─── sat → msat conversion ───

  it('fetchInvoice: 21 sats → calls callback with amount=21000 (msat)', async () => {
    const result = await adapter.fetchInvoice(PAY_PARAMS, 21)
    expect(requestedUrl().searchParams.get('amount')).toBe('21000')
    expect(result.bolt11).toBe('dummy-pr')
  })

  it('fetchInvoice: fractional sats are floored in msat — never inflates the requested amount', async () => {
    await adapter.fetchInvoice(PAY_PARAMS, 21.0009)
    expect(requestedUrl().searchParams.get('amount')).toBe('21000')
  })

  it('fetchInvoice: below minSendable throws without a network request', async () => {
    await expect(adapter.fetchInvoice(PAY_PARAMS, 0)).rejects.toThrow(
      'Amount must be between 1 and 500000 sats',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetchInvoice: above maxSendable throws without a network request', async () => {
    await expect(adapter.fetchInvoice(PAY_PARAMS, 500_001)).rejects.toThrow(
      'Amount must be between 1 and 500000 sats',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetchInvoice: boundaries are inclusive — exact min/max passes', async () => {
    await adapter.fetchInvoice(PAY_PARAMS, 1)
    expect(requestedUrl().searchParams.get('amount')).toBe('1000')

    fetchMock.mockClear().mockResolvedValue(jsonResponse({ pr: 'dummy-pr' }))
    await adapter.fetchInvoice(PAY_PARAMS, 500_000)
    expect(requestedUrl().searchParams.get('amount')).toBe('500000000')
  })

  // ─── comment gating ───

  it('fetchInvoice: sends a comment within the commentAllowed length', async () => {
    await adapter.fetchInvoice(PAY_PARAMS, 21, { comment: 'thanks!' })
    expect(requestedUrl().searchParams.get('comment')).toBe('thanks!')
  })

  it('fetchInvoice: silently drops a comment exceeding commentAllowed', async () => {
    await adapter.fetchInvoice(PAY_PARAMS, 21, { comment: 'x'.repeat(21) })
    expect(requestedUrl().searchParams.get('comment')).toBeNull()
  })

  // ─── error responses ───

  it('fetchInvoice: service ERROR response throws with the reason', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ERROR', reason: 'route not found' }))
    await expect(adapter.fetchInvoice(PAY_PARAMS, 21)).rejects.toThrow('route not found')
  })

  it('fetchInvoice: response missing pr throws', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await expect(adapter.fetchInvoice(PAY_PARAMS, 21)).rejects.toThrow(
      'No payment request returned from LNURL service',
    )
  })

  // ─── resolvePay: Lightning Address ───

  it('resolvePay: user@domain → https well-known path', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      tag: 'payRequest',
      callback: 'https://ln.example.com/cb',
      minSendable: 1000,
      maxSendable: 2000,
      metadata: '[]',
    }))
    const params = await adapter.resolvePay('user@ln.example.com')
    expect(fetchMock.mock.calls[0][0]).toBe('https://ln.example.com/.well-known/lnurlp/user')
    expect(params.domain).toBe('ln.example.com')
  })

  it('resolvePay: .onion domain tries https first, falls back to http', async () => {
    // First attempt (https) fails
    fetchMock.mockRejectedValueOnce(new Error('TLS'))
    // Second attempt (http) succeeds
    fetchMock.mockResolvedValueOnce(jsonResponse({
      tag: 'payRequest',
      callback: 'http://abc.onion/cb',
      minSendable: 1000,
      maxSendable: 2000,
      metadata: '[]',
    }))
    await adapter.resolvePay('user@abc.onion')
    expect(fetchMock.mock.calls[0][0]).toBe('https://abc.onion/.well-known/lnurlp/user')
    expect(fetchMock.mock.calls[1][0]).toBe('http://abc.onion/.well-known/lnurlp/user')
  })

  it.each(['no-at-sign', 'a@b@c.com'])('resolvePay: invalid address (%s) throws', async (address) => {
    await expect(adapter.resolvePay(address)).rejects.toThrow('Invalid Lightning Address')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolvePay: a non-payRequest tag throws', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tag: 'withdrawRequest' }))
    await expect(adapter.resolvePay('user@ln.example.com')).rejects.toThrow(
      'Invalid LNURL tag: expected payRequest, got withdrawRequest',
    )
  })
})
