import { describe, expect, it } from 'vitest'
import { sat } from '@/core/domain/amount'
import {
  cancelReceiveRequest,
  completeReceiveRequest,
  createReceiveMethod,
  createReceiveRequest,
  expireMethod,
  expireMethodsByTime,
  fulfillByMethod,
  fulfillmentFromLegacyStatus,
  normalizeReceivePaymentMethodType,
  receiveAdditionalMethod,
} from '@/core/domain/receive-request'

function makeRequest() {
  return createReceiveRequest({
    id: 'request-1',
    amount: sat(1000),
    accountId: 'https://mint.test',
    expiresAt: 10_000,
    paymentMethods: [
      createReceiveMethod({
        type: 'bolt11',
        ref: 'quote-1',
        encoded: 'lnbc...',
        expiresAt: 10_000,
      }),
      createReceiveMethod({
        type: 'ecash',
        ref: 'ecash-1',
        encoded: 'creq...',
        expiresAt: 10_000,
      }),
    ],
    createdAt: 1_000,
  })
}

describe('ReceiveRequest lifecycle', () => {
  it('creates pending requests with active methods', () => {
    const request = makeRequest()

    expect(request.fulfillmentStatus).toBe('pending')
    expect(request.paymentMethods.map((method) => method.status)).toEqual(['active', 'active'])
  })

  it('fulfills the request by the first received method while leaving other methods active', () => {
    const fulfilled = fulfillByMethod(makeRequest(), 'ecash', 2_000)

    expect(fulfilled.fulfillmentStatus).toBe('fulfilled')
    expect(fulfilled.fulfilledBy).toBe('ecash')
    expect(fulfilled.fulfilledAt).toBe(2_000)
    expect(fulfilled.paymentMethods.find((method) => method.type === 'ecash')?.status).toBe('received')
    expect(fulfilled.paymentMethods.find((method) => method.type === 'bolt11')?.status).toBe('active')
  })

  it('records an additional method without replacing the original fulfillment method', () => {
    const first = fulfillByMethod(makeRequest(), 'ecash', 2_000)
    const second = receiveAdditionalMethod(first, 'bolt11', 3_000)

    expect(second.fulfillmentStatus).toBe('fulfilled')
    expect(second.fulfilledBy).toBe('ecash')
    expect(second.fulfilledAt).toBe(2_000)
    expect(second.paymentMethods.find((method) => method.type === 'bolt11')?.status).toBe('received')
    expect(second.paymentMethods.find((method) => method.type === 'bolt11')?.receivedAt).toBe(3_000)
  })

  it('is idempotent for duplicate settlement on the same method', () => {
    const first = completeReceiveRequest(makeRequest(), 'bolt11', 2_000)
    const duplicate = completeReceiveRequest(first, 'bolt11', 3_000)

    expect(duplicate).toBe(first)
  })

  it('expires one method without expiring the request while another method is active', () => {
    const expiredOne = expireMethod(makeRequest(), 'bolt11', 2_000)

    expect(expiredOne.fulfillmentStatus).toBe('pending')
    expect(expiredOne.paymentMethods.find((method) => method.type === 'bolt11')?.status).toBe('expired')
    expect(expiredOne.paymentMethods.find((method) => method.type === 'ecash')?.status).toBe('active')
  })

  it('expires the request when every active method is past its expiry', () => {
    const request = makeRequest()
    const expired = expireMethodsByTime(request, 11_000)

    expect(expired.fulfillmentStatus).toBe('expired')
    expect(expired.paymentMethods.every((method) => method.status === 'expired')).toBe(true)
  })

  it('keeps fulfilled requests fulfilled while expiring unreceived methods', () => {
    const fulfilled = fulfillByMethod(makeRequest(), 'ecash', 2_000)
    const expired = expireMethodsByTime(fulfilled, 11_000)

    expect(expired.fulfillmentStatus).toBe('fulfilled')
    expect(expired.paymentMethods.find((method) => method.type === 'bolt11')?.status).toBe('expired')
    expect(expired.paymentMethods.find((method) => method.type === 'ecash')?.status).toBe('received')
  })

  it('cancels pending requests without erasing method history', () => {
    const cancelled = cancelReceiveRequest(makeRequest())

    expect(cancelled.fulfillmentStatus).toBe('cancelled')
    expect(cancelled.paymentMethods.every((method) => method.status === 'expired')).toBe(true)
  })

  it('normalizes legacy method names at the boundary', () => {
    expect(normalizeReceivePaymentMethodType('lightning')).toBe('bolt11')
    expect(normalizeReceivePaymentMethodType('nostr-gift-wrap')).toBe('ecash')
    expect(normalizeReceivePaymentMethodType('unknown')).toBeNull()
  })

  it('maps legacy completed status to fulfilled', () => {
    expect(fulfillmentFromLegacyStatus('completed')).toBe('fulfilled')
  })
})
