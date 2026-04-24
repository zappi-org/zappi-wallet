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
})
