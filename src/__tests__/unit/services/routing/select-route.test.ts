import { describe, it, expect } from 'vitest'
import { selectRoute, findCommonMints, selectSourceMint, PaymentRoute, type RouteInput } from '@/core/domain/routing'
import type { ValidatedBolt11, ValidatedLightningAddress, ValidatedLnurlPay, ValidatedCashuRequest, ValidatedMyWallet } from '@/core/domain/input-types'

// ─── Helpers ───

function makeCashuRequest(opts: {
  mints?: string[]
  lightningInvoice?: string
}): ValidatedCashuRequest {
  return {
    type: 'cashu-request',
    request: 'creqB1test',
    parsed: {
      id: 'test-id',
      unit: 'sat',
      mints: opts.mints || [],
      transports: [{ type: 'nostr', target: 'npub1test' }],
      hasNostrTransport: true,
      nostrTarget: 'npub1test',
      hasPostTransport: false,
      lightningInvoice: opts.lightningInvoice,
    },
  }
}

function makeBolt11(): ValidatedBolt11 {
  return {
    type: 'bolt11',
    invoice: 'lnbc1000n1test',
    amountSats: 1000,
    expiry: Date.now() / 1000 + 3600,
  }
}

function makeLightningAddress(): ValidatedLightningAddress {
  return {
    type: 'lightning-address',
    address: 'user@example.com',
    lnurlParams: { tag: 'payRequest', callback: 'https://example.com/lnurlp/user/callback', minSendable: 1000, maxSendable: 1000000, metadata: '[]', domain: 'example.com' },
  }
}

function makeLnurlPay(): ValidatedLnurlPay {
  return {
    type: 'lnurl-pay',
    lnurl: 'lnurl1test',
    params: { tag: 'payRequest', callback: 'https://example.com/lnurlp/callback', minSendable: 1000, maxSendable: 1000000, metadata: '[]', domain: 'example.com' },
  }
}

function makeMyWallet(): ValidatedMyWallet {
  return {
    type: 'my-wallet',
    targetMintUrl: 'https://mint-b.example.com',
    targetMintName: 'Mint B',
  }
}

const senderMints = {
  'https://mint-a.example.com': 5000,
  'https://mint-c.example.com': 3000,
}

function makeInput(validatedData: RouteInput['validatedData'], overrides?: Partial<RouteInput>): RouteInput {
  return {
    validatedData,
    senderMints,
    amount: 1000,
    privacyMode: false,
    ...overrides,
  }
}

// ─── Decision Table Tests ───

describe('selectRoute', () => {
  describe('Non-creq paths', () => {
    it('bolt11 → #5 MELT_TO_LN', () => {
      const result = selectRoute(makeInput(makeBolt11()))
      expect(result).toBe(PaymentRoute.MELT_TO_LN)
    })

    it('lightning-address → #5 MELT_TO_LN', () => {
      const result = selectRoute(makeInput(makeLightningAddress()))
      expect(result).toBe(PaymentRoute.MELT_TO_LN)
    })

    it('lnurl-pay → #5 MELT_TO_LN', () => {
      const result = selectRoute(makeInput(makeLnurlPay()))
      expect(result).toBe(PaymentRoute.MELT_TO_LN)
    })

    it('my-wallet → #3 LN_CROSS_MINT', () => {
      const result = selectRoute(makeInput(makeMyWallet()))
      expect(result).toBe(PaymentRoute.LN_CROSS_MINT)
    })
  })

  describe('creq + m field + common mints', () => {
    const creq = makeCashuRequest({
      mints: ['https://mint-a.example.com', 'https://mint-b.example.com'],
      lightningInvoice: 'lnbc1000n1test',
    })

    it('Case 1: fee-opt + LN → #2 LN_INTERNAL', () => {
      const result = selectRoute(makeInput(creq, { privacyMode: false }))
      expect(result).toBe(PaymentRoute.LN_INTERNAL)
    })

    it('Case 1p: privacy → #1 TOKEN_TRANSFER', () => {
      const result = selectRoute(makeInput(creq, { privacyMode: true }))
      expect(result).toBe(PaymentRoute.TOKEN_TRANSFER)
    })

    it('Case 2: no LN → #1 TOKEN_TRANSFER', () => {
      const creqNoLn = makeCashuRequest({
        mints: ['https://mint-a.example.com'],
      })
      const result = selectRoute(makeInput(creqNoLn, { privacyMode: false }))
      expect(result).toBe(PaymentRoute.TOKEN_TRANSFER)
    })
  })

  describe('creq + m field + NO common mints', () => {
    const creq = makeCashuRequest({
      mints: ['https://mint-b.example.com'],
      lightningInvoice: 'lnbc1000n1test',
    })

    it('Case 3: fee-opt + LN → #3 LN_CROSS_MINT', () => {
      const result = selectRoute(makeInput(creq, { privacyMode: false }))
      expect(result).toBe(PaymentRoute.LN_CROSS_MINT)
    })

    it('Case 3p: privacy → #4 MINT_AND_DM', () => {
      const result = selectRoute(makeInput(creq, { privacyMode: true }))
      expect(result).toBe(PaymentRoute.MINT_AND_DM)
    })

    it('Case 4: no LN → #4 MINT_AND_DM', () => {
      const creqNoLn = makeCashuRequest({
        mints: ['https://mint-b.example.com'],
      })
      const result = selectRoute(makeInput(creqNoLn, { privacyMode: false }))
      expect(result).toBe(PaymentRoute.MINT_AND_DM)
    })

    it('sameMintOnly blocks LN fallback and cross-mint token delivery', () => {
      const strictCreq = makeCashuRequest({
        mints: ['https://mint-b.example.com'],
        lightningInvoice: 'lnbc1000n1test',
      })
      strictCreq.parsed.sameMintOnly = true

      const result = selectRoute(makeInput(strictCreq, { privacyMode: false }))

      expect(result).toBe(PaymentRoute.CANNOT_SEND)
    })
  })

  describe('creq + NO m field', () => {
    const creqNoMints = makeCashuRequest({
      mints: [],
      lightningInvoice: 'lnbc1000n1test',
    })

    it('Case 5: fee-opt + LN → #5 MELT_TO_LN', () => {
      const result = selectRoute(makeInput(creqNoMints, { privacyMode: false }))
      expect(result).toBe(PaymentRoute.MELT_TO_LN)
    })

    it('Case 5p: privacy → #6 OWN_MINT_TOKEN', () => {
      const result = selectRoute(makeInput(creqNoMints, { privacyMode: true }))
      expect(result).toBe(PaymentRoute.OWN_MINT_TOKEN)
    })

    it('Case 6: no LN → #6 OWN_MINT_TOKEN', () => {
      const creqNoLn = makeCashuRequest({ mints: [] })
      const result = selectRoute(makeInput(creqNoLn, { privacyMode: false }))
      expect(result).toBe(PaymentRoute.OWN_MINT_TOKEN)
    })
  })

  describe('No creq + no LN', () => {
    it('Case 8: CANNOT_SEND for unsupported type', () => {
      const result = selectRoute(makeInput({
        type: 'cashu-token',
        token: 'cashuAtest',
        amountSats: 100,
        mintUrl: 'https://mint.example.com',
      } as never))
      expect(result).toBe(PaymentRoute.CANNOT_SEND)
    })
  })
})

// ─── findCommonMints ───

describe('findCommonMints', () => {
  it('finds intersection of sender and receiver mints', () => {
    const result = findCommonMints(
      ['https://mint-a.example.com', 'https://mint-c.example.com'],
      ['https://mint-a.example.com', 'https://mint-b.example.com'],
    )
    expect(result).toEqual(['https://mint-a.example.com'])
  })

  it('returns empty when no overlap', () => {
    const result = findCommonMints(
      ['https://mint-a.example.com'],
      ['https://mint-b.example.com'],
    )
    expect(result).toEqual([])
  })

  it('handles trailing slash normalization', () => {
    const result = findCommonMints(
      ['https://mint-a.example.com/'],
      ['https://mint-a.example.com'],
    )
    expect(result).toEqual(['https://mint-a.example.com/'])
  })
})

// ─── selectSourceMint ───

describe('selectSourceMint', () => {
  const mints = {
    'https://big.mint': 10000,
    'https://small.mint': 1000,
    'https://medium.mint': 5000,
  }

  it('selects smallest sufficient balance (best-fit)', () => {
    const result = selectSourceMint(PaymentRoute.MELT_TO_LN, mints, 2000)
    expect(result).toBe('https://medium.mint')
  })

  it('falls back to largest when none sufficient', () => {
    const result = selectSourceMint(PaymentRoute.MELT_TO_LN, mints, 20000)
    expect(result).toBe('https://big.mint')
  })

  it('prefers common mints for TOKEN_TRANSFER', () => {
    const result = selectSourceMint(
      PaymentRoute.TOKEN_TRANSFER,
      mints,
      500,
      ['https://small.mint'],
    )
    expect(result).toBe('https://small.mint')
  })

  it('returns null for empty mints', () => {
    const result = selectSourceMint(PaymentRoute.MELT_TO_LN, {}, 1000)
    expect(result).toBeNull()
  })
})
