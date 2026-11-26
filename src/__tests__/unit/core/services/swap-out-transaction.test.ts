import { describe, expect, it } from 'vitest'
import { sat } from '@/core/domain/amount'
import type { Transaction } from '@/core/domain/transaction'
import type {
  SwapOutPayment,
  SwapOutRecord,
} from '@/core/ports/driven/swap-out-store.port'
import {
  completedAt,
  isRecorded,
  reachedDispatch,
  transactionFor,
} from '@/core/services/swap-out-transaction'

const MINT = 'https://mint.example.com'
const CREATED_AT = 100
const UPDATED_AT = 2000

function makePayment(patch: Partial<SwapOutPayment> = {}): SwapOutPayment {
  return {
    request: 'fee',
    amount: 45000,
    operationId: 'op-fee',
    feeReserve: 42,
    status: 'prepared',
    feePaid: null,
    settledAt: null,
    ...patch,
  }
}

function makeRecord(patch: Partial<SwapOutRecord> = {}): SwapOutRecord {
  return {
    id: 'payout-1',
    version: 1,
    providerId: 'fake',
    offerId: 'offer-1',
    identifier: 'npub1fake',
    mintUrl: MINT,
    destination: 'bcrt1qdestination',
    sendAmount: 100000,
    receiveAmount: 99000,
    stage: 'quoted',
    phase: 'preparing',
    providerRef: {},
    payments: [],
    payoutTxId: null,
    failureReason: null,
    publishedAt: null,
    deadline: { blockHeight: 209, estimatedAt: UPDATED_AT + 4800000 },
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    ...patch,
  }
}

function makeExisting(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: 'payout-1',
    direction: 'send',
    method: 'swap-out',
    protocol: 'swap-out',
    amount: sat(99000),
    accountId: MINT,
    status: 'settled',
    createdAt: CREATED_AT,
    completedAt: 500,
    fee: { quoted: sat(1084), effective: sat(1085) },
    metadata: { payoutTxId: 'txid-1' },
    ...patch,
  }
}

const TWO_PAYMENTS = [
  makePayment({ request: 'fee', amount: 45000, status: 'paid', feePaid: 40 }),
  makePayment({ request: 'main', amount: 55000, status: 'paid', feePaid: 45 }),
]

describe('reachedDispatch', () => {
  it('is false before any payment is dispatched', () => {
    const record = makeRecord({
      payments: [makePayment(), makePayment({ request: 'main' })],
    })
    expect(reachedDispatch(record)).toBe(false)
  })

  it('is true once dispatchedAt is recorded', () => {
    expect(reachedDispatch(makeRecord({ dispatchedAt: UPDATED_AT }))).toBe(true)
  })

  it.each(['paying', 'funded', 'sweeping'] as const)(
    'is true for the resumable stage %s',
    (stage) => {
      expect(reachedDispatch(makeRecord({ stage }))).toBe(true)
    },
  )

  it.each(['completed', 'refunded'] as const)(
    'is true for the terminal stage %s',
    (stage) => {
      expect(reachedDispatch(makeRecord({ stage }))).toBe(true)
    },
  )

  it('is false for an aborted record with no paid payment', () => {
    const record = makeRecord({
      stage: 'aborted',
      payments: [makePayment({ status: 'rolled_back' })],
    })
    expect(reachedDispatch(record)).toBe(false)
  })

  it('is true when a payment was paid without a dispatch timestamp', () => {
    const record = makeRecord({
      payments: [makePayment({ status: 'paid', feePaid: 12 })],
    })
    expect(reachedDispatch(record)).toBe(true)
  })
})

describe('transactionFor', () => {
  it('records a pending transaction with only the quoted fee', () => {
    const record = makeRecord({
      stage: 'funded',
      phase: 'in_transit',
      payments: TWO_PAYMENTS.map((payment) => ({ ...payment, status: 'dispatched' })),
    })
    expect(transactionFor(record, null)).toEqual({
      id: 'payout-1',
      direction: 'send',
      method: 'swap-out',
      protocol: 'swap-out',
      amount: sat(99000),
      accountId: MINT,
      status: 'pending',
      createdAt: CREATED_AT,
      fee: { quoted: sat(1084) },
      metadata: {
        sendAmount: 100000,
        receiveAmount: 99000,
        destination: 'bcrt1qdestination',
        identifier: 'npub1fake',
        offerId: 'offer-1',
      },
    })
  })

  it('quotes the fixed fee when no payment reserves a fee', () => {
    const record = makeRecord()
    expect(transactionFor(record, null)).toMatchObject({
      status: 'pending',
      amount: sat(99000),
      fee: { quoted: sat(1000) },
    })
  })

  it('settles a completed record with the wallet debit as the effective fee', () => {
    const record = makeRecord({
      stage: 'completed',
      phase: 'settled',
      payments: TWO_PAYMENTS,
      payoutTxId: 'txid-1',
    })
    expect(transactionFor(record, null)).toMatchObject({
      status: 'settled',
      amount: sat(99000),
      fee: { quoted: sat(1084), effective: sat(1085) },
      completedAt: UPDATED_AT,
      metadata: {
        sendAmount: 100000,
        receiveAmount: 99000,
        destination: 'bcrt1qdestination',
        identifier: 'npub1fake',
        offerId: 'offer-1',
        payoutTxId: 'txid-1',
      },
    })
  })

  it('fails a refunded record with the upfront loss and the fee actually paid', () => {
    const record = makeRecord({
      stage: 'refunded',
      phase: 'failed',
      failureReason: 'expired',
      payments: [
        makePayment({ request: 'fee', amount: 45000, status: 'paid', feePaid: 12 }),
        makePayment({ request: 'main', status: 'rolled_back' }),
      ],
    })
    expect(transactionFor(record, null)).toMatchObject({
      status: 'failed',
      amount: sat(45000),
      fee: { quoted: sat(1084), effective: sat(12) },
      completedAt: UPDATED_AT,
      metadata: {
        failureReason: 'expired',
      },
    })
  })

  it('fails an aborted record before anything was paid with a zero amount', () => {
    const record = makeRecord({
      stage: 'aborted',
      phase: 'failed',
      payments: TWO_PAYMENTS.map((payment) => ({ ...payment, status: 'rolled_back' })),
    })
    expect(transactionFor(record, null)).toMatchObject({
      status: 'failed',
      amount: sat(0),
      fee: { quoted: sat(1084), effective: sat(0) },
      completedAt: UPDATED_AT,
    })
  })
})

describe('completedAt', () => {
  it('keeps the first completion time of an existing settled record', () => {
    const record = makeRecord({ stage: 'completed', updatedAt: 9000 })
    expect(completedAt(record, makeExisting({ completedAt: 500 }))).toBe(500)
  })

  it('falls back to updatedAt when there is no existing record', () => {
    expect(completedAt(makeRecord(), null)).toBe(UPDATED_AT)
  })

  it('falls back to updatedAt while the existing record is still pending', () => {
    const existing = makeExisting({ status: 'pending', completedAt: 500 })
    expect(completedAt(makeRecord(), existing)).toBe(UPDATED_AT)
  })

  it('falls back to updatedAt when the existing record has no completedAt', () => {
    const existing = makeExisting({ completedAt: undefined })
    expect(completedAt(makeRecord(), existing)).toBe(UPDATED_AT)
  })
})

describe('isRecorded', () => {
  it('is false when there is no existing transaction', () => {
    expect(isRecorded(null, transactionFor(makeRecord(), null))).toBe(false)
  })

  it('is true for any pending transaction', () => {
    const next = transactionFor(makeRecord(), null)
    expect(isRecorded(makeExisting(), next)).toBe(true)
  })

  it('is true when nothing about a finalized transaction changed', () => {
    const record = makeRecord({
      stage: 'completed',
      payments: TWO_PAYMENTS,
      payoutTxId: 'txid-1',
    })
    const next = transactionFor(record, makeExisting())
    expect(next.completedAt).toBe(500)
    expect(isRecorded(makeExisting(), next)).toBe(true)
  })

  it('is true when a settled record has only a quoted fee equal to the next effective fee', () => {
    const record = makeRecord({
      stage: 'completed',
      payments: TWO_PAYMENTS,
      payoutTxId: 'txid-1',
    })
    const next = transactionFor(record, makeExisting())
    const existing = makeExisting({ fee: { quoted: sat(1085) } })
    expect(existing.fee?.quoted?.value).toBe(next.fee?.effective?.value)
    expect(isRecorded(existing, next)).toBe(true)
  })

  it('is false when a settled record has only a quoted fee that differs from the next effective fee', () => {
    const record = makeRecord({
      stage: 'completed',
      payments: TWO_PAYMENTS,
      payoutTxId: 'txid-1',
    })
    const next = transactionFor(record, makeExisting())
    const existing = makeExisting({ fee: { quoted: sat(1084) } })
    expect(existing.fee?.quoted?.value).not.toBe(next.fee?.effective?.value)
    expect(isRecorded(existing, next)).toBe(false)
  })

  it.each([
    { label: 'status', patch: { status: 'failed' as const } },
    { label: 'amount', patch: { amount: sat(1) } },
    { label: 'completedAt', patch: { completedAt: 501 } },
    { label: 'fee', patch: { fee: { quoted: sat(1084), effective: sat(1) } } },
    { label: 'payoutTxId', patch: { metadata: { payoutTxId: 'txid-2' } } },
  ])('is false when the $label changed', ({ patch }) => {
    const record = makeRecord({
      stage: 'completed',
      payments: TWO_PAYMENTS,
      payoutTxId: 'txid-1',
    })
    const next = transactionFor(record, makeExisting())
    expect(isRecorded(makeExisting(patch), next)).toBe(false)
  })
})
