/**
 * TokenCodecAdapter — amount conversion and input classification safety net.
 *
 * Pinned contracts:
 * - decodeBolt11: msat → sat via Math.floor (never overstates the invoice amount)
 * - parseBitcoinUri: BTC decimal string → sat via Math.round (absorbs parseFloat float error)
 * - inspectCashuToken: sums proofs for both cashuA (JSON) and cashuB (CBOR); bad input throws
 *
 * decodeBolt11 mocks light-bolt11-decoder — what's verified here is our
 * "sections → DecodedInvoice mapping", not the library.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { encode as cborEncode } from 'cbor-x'
import { TokenCodecAdapter } from '@/adapters/codec/token-codec.adapter'
import { amount } from '@/core/domain/amount'

const { decodeMock } = vi.hoisted(() => ({ decodeMock: vi.fn() }))
vi.mock('light-bolt11-decoder', () => ({ decode: decodeMock }))

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function makeCashuA(payload: unknown): string {
  return `cashuA${toBase64Url(new TextEncoder().encode(JSON.stringify(payload)))}`
}

describe('TokenCodecAdapter', () => {
  const codec = new TokenCodecAdapter()

  beforeEach(() => {
    decodeMock.mockReset()
  })

  // ─── decodeBolt11: msat → sat floor ───

  function sections(entries: Array<{ name: string; value: unknown }>) {
    decodeMock.mockReturnValue({ sections: entries })
  }

  it.each([
    ['1000', 1],
    ['1999', 1], // floor — showing 1.999 sat as 2 would overstate
    ['999', 0],
    ['250000000', 250_000],
  ])('decodeBolt11: %s msat → %s sats (floor)', (msat, sats) => {
    sections([{ name: 'amount', value: msat }])
    expect(codec.decodeBolt11('lnbc-test').amountSats).toBe(sats)
  })

  it('decodeBolt11: defaults to 3600s when expiry is absent, expiry = timestamp + expiry', () => {
    const now = Math.floor(Date.now() / 1000)
    sections([
      { name: 'amount', value: '1000' },
      { name: 'timestamp', value: now },
    ])
    const decoded = codec.decodeBolt11('lnbc-test')
    expect(decoded.expiry).toBe(now + 3600)
    expect(decoded.isExpired).toBe(false)
  })

  it('decodeBolt11: past timestamp + short expiry → isExpired', () => {
    sections([
      { name: 'timestamp', value: 1_000_000 },
      { name: 'expiry', value: 60 },
      { name: 'description', value: 'coffee' },
      { name: 'payment_hash', value: 'abc123' },
    ])
    const decoded = codec.decodeBolt11('lnbc-test')
    expect(decoded.isExpired).toBe(true)
    expect(decoded.description).toBe('coffee')
    expect(decoded.paymentHash).toBe('abc123')
  })

  it('decodeBolt11: strips the lightning: prefix and passes it to the decoder', () => {
    sections([{ name: 'amount', value: '1000' }])
    codec.decodeBolt11('lightning:lnbc-test')
    expect(decodeMock).toHaveBeenCalledWith('lnbc-test')
  })

  // ─── isBolt11 / isLightningAddress / isCashuToken classification ───

  it.each([
    ['lnbc1qqq', true],
    ['LNBC1QQQ', true],
    ['lightning:lnbc1qqq', true],
    ['lntb1qqq', true],
    ['lnbcrt1qqq', true],
    ['lnurl1abc', false],
    ['cashuAeyJ0Ijpb', false],
    ['user@ln.example.com', false],
  ])('isBolt11(%s) = %s', (input, expected) => {
    expect(codec.isBolt11(input)).toBe(expected)
  })

  it.each([
    ['user@ln.example.com', true],
    ['user@localhost', false], // reject dotless domain
    ['not-an-address', false],
    ['a@b@c.com', false],
  ])('isLightningAddress(%s) = %s', (input, expected) => {
    expect(codec.isLightningAddress(input)).toBe(expected)
  })

  it('isCashuToken: allows cashuA/cashuB prefix + surrounding whitespace', () => {
    expect(codec.isCashuToken('  cashuAeyJ0Ijpb  ')).toBe(true)
    expect(codec.isCashuToken('cashuBo2F0gaJhaQ')).toBe(true)
    expect(codec.isCashuToken('cashuC-unknown')).toBe(false)
    expect(codec.isCashuToken('lnbc1qqq')).toBe(false)
  })

  // ─── parseBitcoinUri: BTC → sat round ───

  it.each([
    ['0.00000001', 1],
    ['1', 100_000_000],
    // 0.1 * 1e8 = 10000000.000000002 (float) — round absorbs the error
    ['0.1', 10_000_000],
    ['0.00000015', 15],
  ])('parseBitcoinUri: amount=%s BTC → %s sats (round)', (btc, sats) => {
    const parsed = codec.parseBitcoinUri(`bitcoin:bc1qtest?amount=${btc}`)
    expect(parsed?.amount).toBe(sats)
  })

  it('parseBitcoinUri: extracts lightning + creq(NUT-26) params, allows address-less URI', () => {
    const parsed = codec.parseBitcoinUri('bitcoin:?lightning=lnbc1xyz&creq=creqAtest')
    expect(parsed).toEqual({
      address: undefined,
      amount: undefined,
      lightning: 'lnbc1xyz',
      cashuRequest: 'creqAtest',
    })
  })

  it('parseBitcoinUri: legacy cr param backward compatibility', () => {
    const parsed = codec.parseBitcoinUri('bitcoin:bc1qtest?cr=creqAlegacy')
    expect(parsed?.cashuRequest).toBe('creqAlegacy')
  })

  it('parseBitcoinUri: null when not a bitcoin: scheme', () => {
    expect(codec.parseBitcoinUri('litecoin:abc')).toBeNull()
    expect(codec.parseBitcoinUri('lnbc1qqq')).toBeNull()
  })

  // ─── inspectCashuToken: proofs sum ───

  it('cashuA(V3 JSON): sums proof amounts + extracts mint/memo', () => {
    const token = makeCashuA({
      token: [{ mint: 'https://mint.example.com', proofs: [{ amount: 2 }, { amount: 3 }] }],
      unit: 'sat',
      memo: 'hello',
    })
    expect(codec.inspectCashuToken(token)).toEqual({
      mint: 'https://mint.example.com',
      amount: amount(5, 'sat'),
      memo: 'hello',
    })
  })

  it('cashuA: unknown unit falls back to sat, known unit passes through', () => {
    const weird = makeCashuA({ token: [{ mint: 'https://m', proofs: [{ amount: 1 }] }], unit: 'weird' })
    expect(codec.inspectCashuToken(weird).amount).toEqual(amount(1, 'sat'))

    const usd = makeCashuA({ token: [{ mint: 'https://m', proofs: [{ amount: 1 }] }], unit: 'usd' })
    expect(codec.inspectCashuToken(usd).amount).toEqual(amount(1, 'usd'))
  })

  it('cashuB(V4 CBOR): sums proofs per entry', () => {
    const encoded = cborEncode({
      m: 'https://mint.example.com',
      u: 'sat',
      d: 'memo-b',
      t: [{ p: [{ a: 4 }, { a: 8 }] }, { p: [{ a: 16 }] }],
    })
    const token = `cashuB${toBase64Url(new Uint8Array(encoded))}`
    expect(codec.inspectCashuToken(token)).toEqual({
      mint: 'https://mint.example.com',
      amount: amount(28, 'sat'),
      memo: 'memo-b',
    })
  })

  it('bad input throws Invalid Cashu token format', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => codec.inspectCashuToken('cashuA!!!not-base64!!!')).toThrow('Invalid Cashu token format')
      expect(() => codec.inspectCashuToken(`cashuA${toBase64Url(new TextEncoder().encode('not-json'))}`))
        .toThrow('Invalid Cashu token format')
    } finally {
      errorSpy.mockRestore()
    }
  })
})
