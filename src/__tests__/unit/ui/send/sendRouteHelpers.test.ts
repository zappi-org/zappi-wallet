import { describe, expect, it } from 'vitest'

import { PaymentRoute } from '@/core/domain/routing'
import type { ValidatedCashuRequest } from '@/core/domain/input-types'

import { planRouteSelection } from '@/ui/screens/Send/sendRouteHelpers'

function makeCashuRequest(overrides?: Partial<ValidatedCashuRequest['parsed']>): ValidatedCashuRequest {
  return {
    type: 'cashu-request',
    request: 'creqA-test',
    parsed: {
      id: 'req-1',
      unit: 'sat',
      mints: ['https://alpha.mint'],
      transports: [{ type: 'nostr', target: 'npub1target' }],
      hasNostrTransport: true,
      nostrTarget: 'npub1target',
      hasPostTransport: false,
      lightningInvoice: 'lnbc1000n1test',
      ...overrides,
    },
  }
}

describe('planRouteSelection', () => {
  it('uses only the selected source mint when evaluating cashu-request mint matches', () => {
    const validated = makeCashuRequest()
    const result = planRouteSelection({
      validated,
      amount: 1000,
      sourceMintUrl: 'https://lemon.mint',
      balances: {
        'https://alpha.mint': 5000,
        'https://lemon.mint': 5000,
      },
      privacyMode: false,
    })

    expect(result.route).toBe(PaymentRoute.LN_CROSS_MINT)
    expect(result.sourceMintUrl).toBe('https://lemon.mint')
    expect(result.targetMintUrl).toBe('https://alpha.mint')
  })

  it('falls back to token swap route when selected mint is not allowed and no invoice exists', () => {
    const validated = makeCashuRequest({ lightningInvoice: undefined })
    const result = planRouteSelection({
      validated,
      amount: 1000,
      sourceMintUrl: 'https://lemon.mint',
      balances: {
        'https://alpha.mint': 5000,
        'https://lemon.mint': 5000,
      },
      privacyMode: false,
    })

    expect(result.route).toBe(PaymentRoute.MINT_AND_DM)
    expect(result.targetMintUrl).toBe('https://alpha.mint')
  })

  it('keeps same-mint routes when the selected mint is allowed by the request', () => {
    const validated = makeCashuRequest()
    const result = planRouteSelection({
      validated,
      amount: 1000,
      sourceMintUrl: 'https://alpha.mint',
      balances: {
        'https://alpha.mint': 5000,
        'https://lemon.mint': 5000,
      },
      privacyMode: false,
    })

    expect(result.route).toBe(PaymentRoute.LN_INTERNAL)
    expect(result.targetMintUrl).toBe('https://alpha.mint')
  })
})
