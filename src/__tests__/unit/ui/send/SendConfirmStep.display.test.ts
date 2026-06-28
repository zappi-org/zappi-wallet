import { describe, expect, it } from 'vitest'

import { PaymentRoute } from '@/core/domain/routing'
import { getConfirmDisplayInfo } from '@/ui/screens/Send/sendDisplayHelpers'
import { getDestinationDisplay } from '@/ui/screens/Send/sendDisplayHelpers'
import type { ValidatedBolt11, ValidatedCashuRequest } from '@/core/domain/input-types'

const t = (key: string) => {
  if (key === 'send.confirm.lightningInvoice') return 'Lightning 인보이스'
  return key
}

describe('send display text', () => {
  it('does not use a Lightning invoice description as the recipient name', () => {
    const invoice: ValidatedBolt11 = {
      type: 'bolt11',
      invoice: 'lnbc1000n1ecashdescriptiontest',
      amountSats: 1000,
      description: 'eCash',
      expiry: Date.now() + 60_000,
    }

    const display = getConfirmDisplayInfo(invoice, PaymentRoute.MELT_TO_LN, t)

    expect(display.recipient).toBe('Lightning 인보이스')
    expect(display.memo).toBe('eCash')
    expect(getDestinationDisplay(invoice)).toBe('Lightning')
  })

  it('shows Lightning invoice during progress for routed unified payment requests', () => {
    const request: ValidatedCashuRequest = {
      type: 'cashu-request',
      request: 'creqAunifiedtest',
      parsed: {
        id: 'request-1',
        amount: 1000,
        unit: 'sat',
        mints: [],
        transports: [],
        hasNostrTransport: false,
        hasPostTransport: false,
        lightningInvoice: 'lnbc1000n1unifiedtest',
      },
    }

    expect(
      getDestinationDisplay(request, undefined, { route: PaymentRoute.MELT_TO_LN, t })
    ).toBe('Lightning 인보이스')
    expect(
      getDestinationDisplay(request, 'Alice', { route: PaymentRoute.LN_INTERNAL, t })
    ).toBe('Lightning 인보이스')
  })

  it('keeps eCash display for token-routed payment requests', () => {
    const request: ValidatedCashuRequest = {
      type: 'cashu-request',
      request: 'creqAtokentest',
      parsed: {
        id: 'request-2',
        amount: 1000,
        unit: 'sat',
        mints: ['https://mint.example.com'],
        transports: [],
        hasNostrTransport: false,
        hasPostTransport: false,
        lightningInvoice: 'lnbc1000n1tokentest',
      },
    }

    expect(
      getDestinationDisplay(request, undefined, { route: PaymentRoute.TOKEN_TRANSFER, t })
    ).toBe('eCash')
  })
})
