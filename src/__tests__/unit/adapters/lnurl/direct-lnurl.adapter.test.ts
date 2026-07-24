/**
 * DirectLnurlAdapter — sat → msat conversion safety net.
 *
 * Pinned contracts:
 * - fetchInvoice: amountSats * 1000 via Math.floor — never inflates the requested amount
 * - min/maxSendable(msat) bounds are inclusive; out-of-range throws before any network request
 * - the returned invoice's own amount must equal the requested amount
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

/**
 * Real decodable BOLT11 invoices differing only in their amount prefix
 * (re-bech32-encoded from one vector; the decoder does not check signatures).
 * All share timestamp 1648859703 + expiry 172800.
 */
const INVOICE_BODY =
  '1p3y0x3hpp5743k2g0fsqqxj7n8qzuhns5gmkk4djeejk3wkp64ppevgekvc0jsdqcve5kzar2v9nr5gpqd4hkuetesp5ez2g297jduwc20t6lmqlsg3man0vf2jfd8ar9fh8fhn2g8yttfkqxqy9gcqcqzys9qrsgqrzjqtx3k77yrrav9hye7zar2rtqlfkytl094dsp0ms5majzth6gt7ca6uhdkxl983uywgqqqqlgqqqvx5qqjqrzjqd98kxkpyw0l9tyy8r8q57k7zpy9zjmh6sez752wj6gcumqnj3yxzhdsmg6qq56utgqqqqqqqqqqqeqqjq7jd56882gtxhrjm03c93aacyfy306m4fq0tskf83c0nmet8zc2lxyyg3saz8x6vwcp26xnrlagf9semau3qm2glysp7sv95693fphvsp'

/** 2,000,000 msat = 2000 sats */
const INVOICE_2000_SATS = `lnbc20u${INVOICE_BODY}54l567`
/** 2,100,000 msat = 2100 sats */
const INVOICE_2100_SATS = `lnbc21u${INVOICE_BODY}kgljzx`
/** 1,000,000 msat = 1000 sats */
const INVOICE_1000_SATS = `lnbc10u${INVOICE_BODY}x6ks8f`
/** no amount prefix — payee-chosen amount */
const INVOICE_AMOUNTLESS = `lnbc${INVOICE_BODY}p9vfs9`
/** 1,000 msat = 1 sat (minSendable boundary) */
const INVOICE_1_SAT = `lnbc10n${INVOICE_BODY}jlc636`
/** 500,000,000 msat = 500,000 sats (maxSendable boundary) */
const INVOICE_500K_SATS = `lnbc5m${INVOICE_BODY}7qt6lr`

const INVOICE_TIMESTAMP = 1648859703
/** inside the invoices' validity window (timestamp + 172800s) */
const WITHIN_VALIDITY_MS = (INVOICE_TIMESTAMP + 1_000) * 1000

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
    // Invoices are honest by default: 2000 sats requested → 2000 sat invoice.
    vi.useFakeTimers()
    vi.setSystemTime(WITHIN_VALIDITY_MS)
    fetchMock.mockReset().mockResolvedValue(jsonResponse({ pr: INVOICE_2000_SATS }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  function requestedUrl(): URL {
    return new URL(fetchMock.mock.calls[0][0] as string)
  }

  // ─── sat → msat conversion ───

  it('fetchInvoice: 2000 sats → calls callback with amount=2000000 (msat)', async () => {
    const result = await adapter.fetchInvoice(PAY_PARAMS, 2000)
    expect(requestedUrl().searchParams.get('amount')).toBe('2000000')
    expect(result.bolt11).toBe(INVOICE_2000_SATS)
  })

  it('fetchInvoice: fractional sats are floored in msat — never inflates the requested amount', async () => {
    await adapter.fetchInvoice(PAY_PARAMS, 2000.0009)
    expect(requestedUrl().searchParams.get('amount')).toBe('2000000')
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
    fetchMock.mockResolvedValue(jsonResponse({ pr: INVOICE_1_SAT }))
    await adapter.fetchInvoice(PAY_PARAMS, 1)
    expect(requestedUrl().searchParams.get('amount')).toBe('1000')

    fetchMock.mockClear().mockResolvedValue(jsonResponse({ pr: INVOICE_500K_SATS }))
    await adapter.fetchInvoice(PAY_PARAMS, 500_000)
    expect(requestedUrl().searchParams.get('amount')).toBe('500000000')
  })

  // ─── returned invoice amount ───

  it('fetchInvoice: an invoice for MORE than requested is rejected', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pr: INVOICE_2100_SATS }))
    await expect(adapter.fetchInvoice(PAY_PARAMS, 2000)).rejects.toThrow(
      'Invoice amount (2100000 msat) does not match the requested amount (2000000 msat)',
    )
  })

  it('fetchInvoice: an invoice for LESS than requested is rejected', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pr: INVOICE_1000_SATS }))
    await expect(adapter.fetchInvoice(PAY_PARAMS, 2000)).rejects.toThrow(
      'Invoice amount (1000000 msat) does not match the requested amount (2000000 msat)',
    )
  })

  it('fetchInvoice: an amountless invoice is rejected — the payee would pick the amount', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pr: INVOICE_AMOUNTLESS }))
    await expect(adapter.fetchInvoice(PAY_PARAMS, 2000)).rejects.toThrow(
      'LNURL service returned an invoice without an amount',
    )
  })

  it('fetchInvoice: an undecodable invoice is rejected', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ pr: 'not-a-bolt11' }))
    await expect(adapter.fetchInvoice(PAY_PARAMS, 2000)).rejects.toThrow(
      'LNURL service returned an undecodable invoice',
    )
  })

  it('fetchInvoice: an already-expired invoice is rejected', async () => {
    vi.setSystemTime((INVOICE_TIMESTAMP + 172_800 + 1) * 1000)
    await expect(adapter.fetchInvoice(PAY_PARAMS, 2000)).rejects.toThrow(
      'LNURL service returned an already-expired invoice',
    )
  })

  // ─── comment gating ───

  it('fetchInvoice: sends a comment within the commentAllowed length', async () => {
    await adapter.fetchInvoice(PAY_PARAMS, 2000, { comment: 'thanks!' })
    expect(requestedUrl().searchParams.get('comment')).toBe('thanks!')
  })

  it('fetchInvoice: silently drops a comment exceeding commentAllowed', async () => {
    await adapter.fetchInvoice(PAY_PARAMS, 2000, { comment: 'x'.repeat(21) })
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

  it('resolvePay: .onion domain uses http', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      tag: 'payRequest',
      callback: 'http://abc.onion/cb',
      minSendable: 1000,
      maxSendable: 2000,
      metadata: '[]',
    }))
    await adapter.resolvePay('user@abc.onion')
    expect(fetchMock.mock.calls[0][0]).toBe('http://abc.onion/.well-known/lnurlp/user')
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
