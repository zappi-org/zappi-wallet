import { describe, expect, it } from 'vitest'
import type { ValidatedCashuRequest } from '@/core/domain/input-types'
import { selectChatPaymentMint } from '@/ui/screens/Chat/chat-payment-source'

const first = 'https://first.mint'
const second = 'https://second.mint'
const request: ValidatedCashuRequest = {
  type: 'cashu-request',
  request: 'CREQBrequest',
  parsed: {
    id: 'request-1',
    amount: 50, unit: 'sat', mints: [first], transports: [],
    hasNostrTransport: false, hasPostTransport: false,
  },
}

describe('selectChatPaymentMint', () => {
  it('selects a funded source when chat has no active mint', () => {
    expect(selectChatPaymentMint(request, [first, second], { [second]: 100 })).toBe(second)
  })
  it('ignores an empty stale preferred mint', () => {
    expect(selectChatPaymentMint(request, [first, second], { [first]: 0, [second]: 100 }, first)).toBe(second)
  })
  it('prefers a sufficient compatible mint over a funded preferred mint', () => {
    expect(selectChatPaymentMint(request, [first, second], { [first]: 60, [second]: 100 }, second)).toBe(first)
  })
  it('does not prefer an insufficient compatible mint over a sufficient alternative', () => {
    expect(selectChatPaymentMint(request, [first, second], { [first]: 40, [second]: 100 }, first)).toBe(second)
  })
  it('matches canonical URLs but keeps the balance source identifier', () => {
    expect(selectChatPaymentMint(request, ['https://FIRST.mint:443/'], { [first]: 60 })).toBe(first)
  })
  it('never selects an unconfigured mint from balances', () => {
    expect(selectChatPaymentMint(request, [first], { [second]: 100 })).toBe(first)
  })
  it('uses the largest available balance when all balances are insufficient', () => {
    expect(selectChatPaymentMint(request, [first, second], { [first]: 20, [second]: 40 }, first)).toBe(second)
  })
  it('keeps the configured preference when there are no funds', () => {
    expect(selectChatPaymentMint(request, [first, second], {}, second)).toBe(second)
  })
  it('does not choose an incompatible source for a same-mint-only request', () => {
    const strict = { ...request, parsed: { ...request.parsed, sameMintOnly: true } }
    expect(selectChatPaymentMint(strict, [first, second], { [second]: 100 })).toBe(first)
    expect(selectChatPaymentMint(strict, [second], { [second]: 100 })).toBeNull()
  })
  it('returns null when there is no configured source', () => {
    expect(selectChatPaymentMint(request, [], { [first]: 100 })).toBeNull()
  })
  it('selects a funded preference for a Lightning request', () => {
    expect(selectChatPaymentMint(
      { type: 'bolt11', invoice: 'lnbc-test', amountSats: 50, expiry: 9999999999 },
      [first, second], { [first]: 60, [second]: 100 }, second,
    )).toBe(second)
  })
})
