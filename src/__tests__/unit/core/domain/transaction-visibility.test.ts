import { describe, expect, it } from 'vitest'
import { sat } from '@/core/domain/amount'
import { createReceiveMethod, createReceiveRequest, fulfillByMethod } from '@/core/domain/receive-request'
import type { Transaction } from '@/core/domain/transaction'
import {
  hiddenPendingReceiveTransactionRefs,
  isVisibleTransaction,
} from '@/core/domain/transaction-visibility'

function makeTx(overrides?: Partial<Transaction>): Transaction {
  return {
    id: 'quote-1',
    direction: 'receive',
    method: 'cashu:bolt11',
    protocol: 'bolt11',
    amount: sat(1000),
    accountId: 'https://mint.test',
    status: 'pending',
    createdAt: 1_000,
    metadata: { quoteId: 'quote-1' },
    ...overrides,
  }
}

describe('transaction visibility', () => {
  it('hides pending receive transactions for unreceived methods on fulfilled requests', () => {
    const request = fulfillByMethod(createReceiveRequest({
      id: 'request-1',
      amount: sat(1000),
      accountId: 'https://mint.test',
      createdAt: 1_000,
      expiresAt: 10_000,
      paymentMethods: [
        createReceiveMethod({ type: 'bolt11', ref: 'quote-1', encoded: 'lnbc...', expiresAt: 10_000 }),
        createReceiveMethod({ type: 'ecash', ref: 'ecash-1', encoded: 'creq...', expiresAt: 10_000 }),
      ],
    }), 'ecash', 2_000)

    const hiddenRefs = hiddenPendingReceiveTransactionRefs([request])

    expect(isVisibleTransaction(makeTx(), hiddenRefs)).toBe(false)
    expect(isVisibleTransaction(makeTx({ status: 'settled' }), hiddenRefs)).toBe(true)
    expect(isVisibleTransaction(makeTx({ direction: 'send' }), hiddenRefs)).toBe(true)
  })

  it('hides an open request’s projections — the request item is its single face', () => {
    const request = createReceiveRequest({
      id: 'request-1',
      amount: sat(1000),
      accountId: 'https://mint.test',
      createdAt: 1_000,
      expiresAt: 10_000,
      paymentMethods: [
        createReceiveMethod({ type: 'bolt11', ref: 'quote-1', encoded: 'lnbc...', expiresAt: 10_000 }),
        createReceiveMethod({ type: 'ecash', ref: 'ecash-1', encoded: 'creq...', expiresAt: 10_000 }),
      ],
    })

    const hiddenRefs = hiddenPendingReceiveTransactionRefs([request])

    // The pending lightning projection must not double as a visible receive.
    expect(isVisibleTransaction(makeTx(), hiddenRefs)).toBe(false)
    // Projection rows are keyed by metadata.quoteId even under a different id.
    expect(isVisibleTransaction(makeTx({ id: 'tx-uuid-1' }), hiddenRefs)).toBe(false)
  })

  it('hides failed residue rows after a request expires', () => {
    const request = createReceiveRequest({
      id: 'request-1',
      amount: sat(1000),
      accountId: 'https://mint.test',
      createdAt: 1_000,
      expiresAt: 10_000,
      fulfillmentStatus: 'expired',
      paymentMethods: [
        createReceiveMethod({ type: 'bolt11', ref: 'quote-1', encoded: 'lnbc...', expiresAt: 10_000 }),
      ],
    })

    const hiddenRefs = hiddenPendingReceiveTransactionRefs([request])

    expect(isVisibleTransaction(makeTx({ id: 'tx-uuid-1', status: 'failed' }), hiddenRefs)).toBe(false)
    // An unrelated failed receive keeps its place in history.
    expect(isVisibleTransaction(makeTx({ id: 'tx-other', status: 'failed', metadata: {} }), hiddenRefs)).toBe(true)
  })
})
