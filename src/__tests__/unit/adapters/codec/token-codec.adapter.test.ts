/**
 * TokenCodecAdapter — 금액 변환·입력 판별 안전망 (감사 잔여 Phase 0)
 *
 * 핀 대상 계약:
 * - decodeBolt11: msat → sat 은 Math.floor (인보이스 금액을 절대 과대 표시하지 않는다)
 * - parseBitcoinUri: BTC 소수 문자열 → sat 은 Math.round (parseFloat 부동소수 오차 흡수)
 * - inspectCashuToken: cashuA(JSON)/cashuB(CBOR) 양쪽에서 proofs 합산, 잘못된 입력은 throw
 *
 * decodeBolt11 은 light-bolt11-decoder 를 모킹한다 — 여기서 검증하는 것은
 * 라이브러리가 아니라 "섹션 → DecodedInvoice 매핑(우리 코드)"이다.
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
    ['1999', 1], // floor — 1.999 sat 을 2로 올려 표시하면 과대 표시
    ['999', 0],
    ['250000000', 250_000],
  ])('decodeBolt11: %s msat → %s sats (floor)', (msat, sats) => {
    sections([{ name: 'amount', value: msat }])
    expect(codec.decodeBolt11('lnbc-test').amountSats).toBe(sats)
  })

  it('decodeBolt11: expiry 부재 시 기본 3600초, expiry = timestamp + expiry', () => {
    const now = Math.floor(Date.now() / 1000)
    sections([
      { name: 'amount', value: '1000' },
      { name: 'timestamp', value: now },
    ])
    const decoded = codec.decodeBolt11('lnbc-test')
    expect(decoded.expiry).toBe(now + 3600)
    expect(decoded.isExpired).toBe(false)
  })

  it('decodeBolt11: 과거 timestamp + 짧은 expiry → isExpired', () => {
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

  it('decodeBolt11: lightning: 프리픽스를 제거하고 디코더에 전달', () => {
    sections([{ name: 'amount', value: '1000' }])
    codec.decodeBolt11('lightning:lnbc-test')
    expect(decodeMock).toHaveBeenCalledWith('lnbc-test')
  })

  // ─── isBolt11 / isLightningAddress / isCashuToken 판별 ───

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
    ['user@localhost', false], // 도트 없는 도메인 거부
    ['not-an-address', false],
    ['a@b@c.com', false],
  ])('isLightningAddress(%s) = %s', (input, expected) => {
    expect(codec.isLightningAddress(input)).toBe(expected)
  })

  it('isCashuToken: cashuA/cashuB 프리픽스 + 앞뒤 공백 허용', () => {
    expect(codec.isCashuToken('  cashuAeyJ0Ijpb  ')).toBe(true)
    expect(codec.isCashuToken('cashuBo2F0gaJhaQ')).toBe(true)
    expect(codec.isCashuToken('cashuC-unknown')).toBe(false)
    expect(codec.isCashuToken('lnbc1qqq')).toBe(false)
  })

  // ─── parseBitcoinUri: BTC → sat round ───

  it.each([
    ['0.00000001', 1],
    ['1', 100_000_000],
    // 0.1 * 1e8 = 10000000.000000002 (부동소수) — round 가 오차를 흡수한다
    ['0.1', 10_000_000],
    ['0.00000015', 15],
  ])('parseBitcoinUri: amount=%s BTC → %s sats (round)', (btc, sats) => {
    const parsed = codec.parseBitcoinUri(`bitcoin:bc1qtest?amount=${btc}`)
    expect(parsed?.amount).toBe(sats)
  })

  it('parseBitcoinUri: lightning + creq(NUT-26) 파라미터 추출, 주소 없는 URI 허용', () => {
    const parsed = codec.parseBitcoinUri('bitcoin:?lightning=lnbc1xyz&creq=creqAtest')
    expect(parsed).toEqual({
      address: undefined,
      amount: undefined,
      lightning: 'lnbc1xyz',
      cashuRequest: 'creqAtest',
    })
  })

  it('parseBitcoinUri: legacy cr 파라미터 하위호환', () => {
    const parsed = codec.parseBitcoinUri('bitcoin:bc1qtest?cr=creqAlegacy')
    expect(parsed?.cashuRequest).toBe('creqAlegacy')
  })

  it('parseBitcoinUri: bitcoin: 스킴이 아니면 null', () => {
    expect(codec.parseBitcoinUri('litecoin:abc')).toBeNull()
    expect(codec.parseBitcoinUri('lnbc1qqq')).toBeNull()
  })

  // ─── inspectCashuToken: proofs 합산 ───

  it('cashuA(V3 JSON): proofs 금액 합산 + mint/memo 추출', () => {
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

  it('cashuA: 알 수 없는 unit 은 sat 으로 폴백, 알려진 unit 은 통과', () => {
    const weird = makeCashuA({ token: [{ mint: 'https://m', proofs: [{ amount: 1 }] }], unit: 'weird' })
    expect(codec.inspectCashuToken(weird).amount).toEqual(amount(1, 'sat'))

    const usd = makeCashuA({ token: [{ mint: 'https://m', proofs: [{ amount: 1 }] }], unit: 'usd' })
    expect(codec.inspectCashuToken(usd).amount).toEqual(amount(1, 'usd'))
  })

  it('cashuB(V4 CBOR): 엔트리별 proofs 합산', () => {
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

  it('잘못된 입력은 Invalid Cashu token format 으로 throw', () => {
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
