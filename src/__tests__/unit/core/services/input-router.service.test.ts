import { describe, it, expect, vi, beforeEach } from 'vitest'
import { InputRouter } from '@/core/services/input-router.service'
import type { LnurlGateway, LnurlResponse } from '@/core/ports/driven/lnurl-gateway.port'

// ─── Fixtures ───

const LNURL_ENCODED = 'lnurl1dp68gurn8ghj7um9wfmxjcm99e6x2um59ashq6flwy7nzecexe5'

const PAY_RESPONSE: LnurlResponse = {
  tag: 'payRequest',
  callback: 'https://service.test/cb',
  minSendable: 1000,
  maxSendable: 1_000_000_000,
  metadata: '[]',
  domain: 'service.test',
}

const WITHDRAW_RESPONSE: LnurlResponse = {
  tag: 'withdrawRequest',
  callback: 'https://service.test/withdraw',
  k1: 'abc123',
  minWithdrawable: 1000,
  maxWithdrawable: 500_000_000,
  defaultDescription: 'withdraw',
  domain: 'service.test',
}

const AUTH_RESPONSE: LnurlResponse = {
  tag: 'login',
  callback: 'https://service.test/auth',
  k1: 'def456',
  domain: 'service.test',
}

// ─── Mock ───

function createMock() {
  return {
    fetchLnurl: vi.fn<(url: string) => Promise<LnurlResponse>>(),
  } satisfies Pick<LnurlGateway, 'fetchLnurl'>
}

// ─���─ Tests ───

describe('InputRouter', () => {
  let router: InputRouter
  let lnurl: ReturnType<typeof createMock>

  beforeEach(() => {
    lnurl = createMock()
    router = new InputRouter(lnurl)
  })

  // ── BOLT11 ──

  it('classifies mainnet invoice', async () => {
    const result = await router.classify('lnbc1pvjluezpp5...')
    expect(result.type).toBe('invoice')
    if (result.type === 'invoice') expect(result.bolt11).toBe('lnbc1pvjluezpp5...')
  })

  it('classifies testnet invoice', async () => {
    const result = await router.classify('lntb1abc...')
    expect(result.type).toBe('invoice')
  })

  it('strips lightning: prefix from invoice', async () => {
    const result = await router.classify('lightning:lnbc1pvjluezpp5...')
    expect(result.type).toBe('invoice')
    if (result.type === 'invoice') expect(result.bolt11).toBe('lnbc1pvjluezpp5...')
  })

  // ── Cashu ──

  it('classifies cashu token (v3)', async () => {
    const result = await router.classify('cashuAeyJ0...')
    expect(result.type).toBe('cashu-token')
    if (result.type === 'cashu-token') expect(result.token).toBe('cashuAeyJ0...')
  })

  it('classifies cashu token (v4)', async () => {
    const result = await router.classify('cashuBo2F0...')
    expect(result.type).toBe('cashu-token')
  })

  // ── LNURL ──

  it('classifies lnurl-pay', async () => {
    lnurl.fetchLnurl.mockResolvedValue(PAY_RESPONSE)

    const result = await router.classify(LNURL_ENCODED)

    expect(result.type).toBe('lnurl-pay')
    expect(lnurl.fetchLnurl).toHaveBeenCalledWith('https://service.test/api?q=1')
  })

  it('classifies lnurl-withdraw', async () => {
    lnurl.fetchLnurl.mockResolvedValue(WITHDRAW_RESPONSE)

    const result = await router.classify(LNURL_ENCODED)

    expect(result.type).toBe('lnurl-withdraw')
    if (result.type === 'lnurl-withdraw') {
      expect(result.params.k1).toBe('abc123')
    }
  })

  it('classifies lnurl-auth', async () => {
    lnurl.fetchLnurl.mockResolvedValue(AUTH_RESPONSE)

    const result = await router.classify(LNURL_ENCODED)

    expect(result.type).toBe('lnurl-auth')
    if (result.type === 'lnurl-auth') {
      expect(result.params.k1).toBe('def456')
    }
  })

  // ── nostr addresses ──

  it('classifies npub', async () => {
    const result = await router.classify('npub15xev848976sm9s75uhm2rvkr6njldgdjc02wta4pktpafe0k5xeqd3u8ss')
    expect(result.type).toBe('address')
    if (result.type === 'address') expect(result.addressType).toBe('npub')
  })

  it('classifies nprofile', async () => {
    const result = await router.classify('nprofile1qqs2rvkr6njldgdjc02wta4pktpafe0k5xev848976sm9s75uhm2rvs6v8skw')
    expect(result.type).toBe('address')
    if (result.type === 'address') expect(result.addressType).toBe('nprofile')
  })

  // ── bolt12 ──

  it('classifies bolt12 offer', async () => {
    const result = await router.classify('lno1qgsqvgnwgcg35z6ee2h3yczraddm72xrfua9uve2rlrm9deu7xyfzrcsjq')
    expect(result.type).toBe('address')
    if (result.type === 'address') expect(result.addressType).toBe('bolt12')
  })

  // ── Lightning Address ──

  it('classifies lightning address', async () => {
    const result = await router.classify('alice@domain.test')
    expect(result.type).toBe('address')
    if (result.type === 'address') {
      expect(result.addressType).toBe('email')
      expect(result.value).toBe('alice@domain.test')
    }
  })

  // ── Unknown ──

  it('throws on unrecognized input', async () => {
    await expect(router.classify('garbage')).rejects.toThrow('Unrecognized input')
  })
})
