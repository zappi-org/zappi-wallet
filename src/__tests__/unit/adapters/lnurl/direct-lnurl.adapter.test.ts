/**
 * DirectLnurlAdapter — sat → msat 변환 안전망 (감사 잔여 Phase 0)
 *
 * 핀 대상 계약:
 * - fetchInvoice: amountSats * 1000 을 Math.floor — 요청 금액을 절대 부풀리지 않는다
 * - min/maxSendable(msat) 경계는 포함(inclusive), 벗어나면 즉시 throw (네트워크 요청 전)
 * - comment 는 commentAllowed 길이 내에서만 전송
 * - resolvePay: Lightning Address 형식 검증 + well-known 경로 조립
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
    // 'dummy-pr' 은 유효한 bolt11 이 아니라 description_hash 검증이 스킵된다
    // (디코드 실패는 verifyDescriptionHash 가 의도적으로 무시 — 해시 불일치만 throw)
    fetchMock.mockReset().mockResolvedValue(jsonResponse({ pr: 'dummy-pr' }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function requestedUrl(): URL {
    return new URL(fetchMock.mock.calls[0][0] as string)
  }

  // ─── sat → msat 변환 ───

  it('fetchInvoice: 21 sats → amount=21000 (msat) 으로 콜백 호출', async () => {
    const result = await adapter.fetchInvoice(PAY_PARAMS, 21)
    expect(requestedUrl().searchParams.get('amount')).toBe('21000')
    expect(result.bolt11).toBe('dummy-pr')
  })

  it('fetchInvoice: 소수 sat 은 msat 에서 floor — 요청 금액을 부풀리지 않는다', async () => {
    await adapter.fetchInvoice(PAY_PARAMS, 21.0009)
    expect(requestedUrl().searchParams.get('amount')).toBe('21000')
  })

  it('fetchInvoice: minSendable 미만이면 네트워크 요청 없이 throw', async () => {
    await expect(adapter.fetchInvoice(PAY_PARAMS, 0)).rejects.toThrow(
      'Amount must be between 1 and 500000 sats',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetchInvoice: maxSendable 초과면 네트워크 요청 없이 throw', async () => {
    await expect(adapter.fetchInvoice(PAY_PARAMS, 500_001)).rejects.toThrow(
      'Amount must be between 1 and 500000 sats',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetchInvoice: 경계값은 포함 — min/max 정확히 일치하면 통과', async () => {
    await adapter.fetchInvoice(PAY_PARAMS, 1)
    expect(requestedUrl().searchParams.get('amount')).toBe('1000')

    fetchMock.mockClear().mockResolvedValue(jsonResponse({ pr: 'dummy-pr' }))
    await adapter.fetchInvoice(PAY_PARAMS, 500_000)
    expect(requestedUrl().searchParams.get('amount')).toBe('500000000')
  })

  // ─── comment 게이팅 ───

  it('fetchInvoice: commentAllowed 길이 내 comment 는 전송', async () => {
    await adapter.fetchInvoice(PAY_PARAMS, 21, { comment: 'thanks!' })
    expect(requestedUrl().searchParams.get('comment')).toBe('thanks!')
  })

  it('fetchInvoice: commentAllowed 초과 comment 는 조용히 제외', async () => {
    await adapter.fetchInvoice(PAY_PARAMS, 21, { comment: 'x'.repeat(21) })
    expect(requestedUrl().searchParams.get('comment')).toBeNull()
  })

  // ─── 에러 응답 ───

  it('fetchInvoice: 서비스 ERROR 응답은 reason 으로 throw', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ status: 'ERROR', reason: 'route not found' }))
    await expect(adapter.fetchInvoice(PAY_PARAMS, 21)).rejects.toThrow('route not found')
  })

  it('fetchInvoice: pr 누락 응답은 throw', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}))
    await expect(adapter.fetchInvoice(PAY_PARAMS, 21)).rejects.toThrow(
      'No payment request returned from LNURL service',
    )
  })

  // ─── resolvePay: Lightning Address ───

  it('resolvePay: user@domain → https well-known 경로', async () => {
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

  it('resolvePay: .onion 도메인은 http 사용', async () => {
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

  it.each(['no-at-sign', 'a@b@c.com'])('resolvePay: 잘못된 주소(%s)는 throw', async (address) => {
    await expect(adapter.resolvePay(address)).rejects.toThrow('Invalid Lightning Address')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolvePay: payRequest 가 아닌 tag 는 throw', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ tag: 'withdrawRequest' }))
    await expect(adapter.resolvePay('user@ln.example.com')).rejects.toThrow(
      'Invalid LNURL tag: expected payRequest, got withdrawRequest',
    )
  })
})
