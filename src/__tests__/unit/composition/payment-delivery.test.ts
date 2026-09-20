import { describe, expect, it, vi } from 'vitest'
import { PaymentDelivery } from '@/composition/payment-delivery'
import type { ParsedCashuRequest } from '@/core/domain/input-types'
import type { OutgoingPaymentTransport } from '@/core/ports/driven/outgoing-payment-transport.port'

const decodeToken = vi.fn().mockResolvedValue({
  mint: 'https://mint.test',
  unit: 'sat',
  proofs: [],
})

function makeRequest(overrides: Partial<ParsedCashuRequest> = {}): ParsedCashuRequest {
  return {
    id: 'req-1',
    unit: 'sat',
    mints: ['https://mint.test'],
    transports: [],
    hasNostrTransport: false,
    hasPostTransport: false,
    ...overrides,
  }
}

describe('PaymentDelivery', () => {
  it('delivers over nostr when the request names a nostr transport', async () => {
    const transport: OutgoingPaymentTransport = {
      send: vi.fn().mockResolvedValue({ success: true }),
    }
    const delivery = new PaymentDelivery(transport, decodeToken)

    const result = await delivery.deliverToken({
      token: 'cashuAtoken',
      parsedRequest: makeRequest({
        transports: [{ type: 'nostr', target: 'nprofile1abc' }],
        hasNostrTransport: true,
        nostrTarget: 'nprofile1abc',
      }),
    })

    expect(result).toEqual({ success: true, transportUsed: 'nostr' })
    expect(transport.send).toHaveBeenCalledWith(expect.objectContaining({
      recipientPubkey: 'nprofile1abc',
      token: 'cashuAtoken',
    }))
  })

  it('reports failure when the nostr transport could not reach the payee', async () => {
    const transport: OutgoingPaymentTransport = {
      send: vi.fn().mockResolvedValue({ success: false, error: 'No relays available' }),
    }
    const delivery = new PaymentDelivery(transport, decodeToken)

    const result = await delivery.deliverToken({
      token: 'cashuAtoken',
      parsedRequest: makeRequest({
        transports: [{ type: 'nostr', target: 'nprofile1abc' }],
        hasNostrTransport: true,
        nostrTarget: 'nprofile1abc',
      }),
    })

    expect(result).toEqual({ success: false, transportUsed: 'none' })
  })

  // A "sent" receipt for a token nobody received is the worst outcome: the funds
  // stay committed while the UI says the payment went through.
  it('reports failure for a request that declares no usable transport', async () => {
    const transport: OutgoingPaymentTransport = { send: vi.fn() }
    const delivery = new PaymentDelivery(transport, decodeToken)

    const result = await delivery.deliverToken({
      token: 'cashuAtoken',
      parsedRequest: makeRequest(),
    })

    expect(result).toEqual({ success: false, transportUsed: 'none' })
    expect(transport.send).not.toHaveBeenCalled()
  })

  it('treats a bearer token with no request as delivered — the sender hands it over', async () => {
    const transport: OutgoingPaymentTransport = { send: vi.fn() }
    const delivery = new PaymentDelivery(transport, decodeToken)

    const result = await delivery.deliverToken({ token: 'cashuAtoken' })

    expect(result).toEqual({ success: true, transportUsed: 'none' })
    expect(transport.send).not.toHaveBeenCalled()
  })
})
