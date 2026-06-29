import { describe, expect, it } from 'vitest'

import { PaymentRoute } from '@/core/domain/routing'
import {
  formatNpubShort,
  formatRecipientDisplayText,
  getConfirmDisplayInfo,
  getDestinationDisplay,
  shouldShowRecipientInMainMessage,
} from '@/ui/screens/Send/sendDisplayHelpers'
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
    expect(shouldShowRecipientInMainMessage(invoice)).toBe(false)
    expect(getDestinationDisplay(invoice)).toBe('Lightning')
  })

  it('hides request recipients from main copy for routed unified payment requests', () => {
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

    expect(shouldShowRecipientInMainMessage(request)).toBe(false)
    expect(
      getDestinationDisplay(request, undefined, { route: PaymentRoute.MELT_TO_LN, t })
    ).toBe('Lightning 인보이스')
    expect(
      getDestinationDisplay(request, 'Alice', { route: PaymentRoute.LN_INTERNAL, t })
    ).toBe('Lightning 인보이스')
  })

  it('hides eCash payment request recipients from main copy for token-routed payment requests', () => {
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

    expect(shouldShowRecipientInMainMessage(request)).toBe(false)
    expect(
      getDestinationDisplay(request, undefined, { route: PaymentRoute.TOKEN_TRANSFER, t })
    ).toBe('eCash')
  })

  it('keeps direct npub recipients in main copy and shortens long labels', () => {
    const npub = 'npub1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq'
    const request: ValidatedCashuRequest = {
      type: 'cashu-request',
      request: npub,
      parsed: {
        id: 'direct-1',
        amount: 1000,
        unit: 'sat',
        mints: ['https://mint.example.com'],
        transports: [{ type: 'nostr', target: npub }],
        hasNostrTransport: true,
        nostrTarget: npub,
        hasPostTransport: false,
        sameMintOnly: true,
      },
    }

    expect(shouldShowRecipientInMainMessage(request)).toBe(true)
    expect(getDestinationDisplay(request)).toBe(formatNpubShort(npub))
    expect(getDestinationDisplay(request, '가나다라마바사아자차카타파하')).toBe('가나다라마바사아자차카타...')
    expect(formatRecipientDisplayText('npub1abcdef0123456789')).toBe('npub1abc...6789')
  })
})
