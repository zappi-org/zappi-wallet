import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Ok } from '@/core/domain/result'
import {
  OnchainPayoutAmountOutOfRangeError,
  OnchainPayoutInvalidDestinationError,
  OnchainPayoutOfferUnavailableError,
  OnchainPayoutProviderRejectedError,
  OnchainPayoutQuoteExpiredError,
  OnchainPayoutUnavailableError,
} from '@/core/errors/onchain-payout'
import type {
  OnchainPayoutAdvance,
  OnchainPayoutOffer,
  OnchainPayoutProgress,
  OnchainPayoutProvider,
  OnchainPayoutQuote,
  OnchainPayoutStartResult,
} from '@/core/ports/driven/onchain-payout-provider.port'
import type {
  OnchainPayoutRecord,
  OnchainPayoutStore,
  OnchainPayoutUpdate,
} from '@/core/ports/driven/onchain-payout-store.port'
import type {
  OnchainPayoutQuoteView,
  OnchainPayoutUseCase,
  OnchainPayoutView,
} from '@/core/ports/driving/onchain-payout.usecase'

const offer = {
  offerId: 'offer-1',
  identifier: 'npub1provider',
  feePercent: 0.3,
  networkFee: 150,
  payoutFeeRate: 2,
  payoutFeeEstimate: 136,
  minAmount: 20000,
  maxAmount: 1000000,
  seenAt: 1700000000000,
} satisfies OnchainPayoutOffer

const quote = {
  providerId: 'provider-1',
  offerId: offer.offerId,
  identifier: offer.identifier,
  destination: 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080',
  sendAmount: 100000,
  receiveAmount: 99000,
  serviceFee: 700,
  networkFee: 300,
  sweepFee: 136,
  limits: { minAmount: 1000, maxAmount: 10000000 },
  estimatedMinutes: 10,
  offerRef: { id: 'offer-1', tags: ['a', 'b'] },
  expiresAt: 1700000000000,
} satisfies OnchainPayoutQuote

const quoteView = {
  quoteId: 'quote-1',
  providerId: quote.providerId,
  offerId: quote.offerId,
  identifier: quote.identifier,
  destination: quote.destination,
  sendAmount: quote.sendAmount,
  receiveAmount: quote.receiveAmount,
  serviceFee: quote.serviceFee,
  networkFee: quote.networkFee,
  sweepFee: quote.sweepFee,
  limits: quote.limits,
  estimatedMinutes: quote.estimatedMinutes,
  expiresAt: quote.expiresAt,
} satisfies OnchainPayoutQuoteView

const deadline = { blockHeight: 500000, estimatedAt: 1700003600000 }

const startResult = {
  providerRef: { id: 'payout-1' },
  secrets: 'sealed-secrets',
  paymentRequests: [
    { request: 'request-a', amount: 60000 },
    { request: 'request-b', amount: 40000 },
  ],
  sendAmount: 100000,
  receiveAmount: 99000,
  deadline,
} satisfies OnchainPayoutStartResult

const progress = {
  stage: 'funded',
  payoutTxId: 'payout-tx-1',
  confirmations: 1,
  currentHeight: 400100,
} satisfies OnchainPayoutProgress

const advance = {
  progress: { stage: 'sweeping', payoutTxId: 'payout-tx-1', currentHeight: 400101 },
  prepared: { secrets: 'sealed-signed', payoutTxId: 'payout-tx-1' },
} satisfies OnchainPayoutAdvance

const record = {
  id: 'payout-1',
  version: 1,
  providerId: 'provider-1',
  mintUrl: 'https://mint.example.com',
  destination: quote.destination,
  sendAmount: 100000,
  receiveAmount: 99000,
  stage: 'paying',
  phase: 'submitted',
  providerRef: startResult.providerRef,
  payments: [
    {
      request: 'request-a',
      amount: 60000,
      operationId: 'op-1',
      feeReserve: 300,
      status: 'dispatched',
      feePaid: null,
      settledAt: null,
    },
    {
      request: 'request-b',
      amount: 40000,
      operationId: 'op-2',
      feeReserve: 300,
      status: 'paid',
      feePaid: 290,
      settledAt: 1700000000000,
    },
  ],
  payoutTxId: null,
  failureReason: null,
  publishedAt: null,
  deadline,
  createdAt: 1,
  updatedAt: 1,
} satisfies OnchainPayoutRecord

const view = {
  id: record.id,
  mintUrl: record.mintUrl,
  offerId: offer.offerId,
  identifier: offer.identifier,
  destination: record.destination,
  sendAmount: record.sendAmount,
  receiveAmount: record.receiveAmount,
  stage: record.stage,
  phase: record.phase,
  payoutTxId: null,
  failureReason: null,
  hasOpenPayments: true,
  deadline: record.deadline,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
} satisfies OnchainPayoutView

const provider = {
  id: 'provider-1',
  async listOffers() {
    return [offer]
  },
  async quote() {
    return quote
  },
  async start() {
    return startResult
  },
  async resume() {
    return advance
  },
  async publish() {
    return progress
  },
  async status() {
    return progress
  },
} satisfies OnchainPayoutProvider

let storeVersion = 1

const store = {
  async create() {},
  async get() {
    return record
  },
  async update(_id: string, expectedVersion: number, _changes?: OnchainPayoutUpdate) {
    return expectedVersion === storeVersion
  },
  async readSecrets() {
    return startResult.secrets
  },
  async listActive() {
    return [record]
  },
  async list() {
    return [record]
  },
} satisfies OnchainPayoutStore

const useCase = {
  isEnabled() {
    return true
  },
  async listOffers() {
    return Ok([offer])
  },
  async quote() {
    return Ok(quoteView)
  },
  async start() {
    return Ok(view)
  },
  async resumeAll() {},
  async get() {
    return view
  },
  async listActive() {
    return [view]
  },
  async inFlightAmount(_mintUrl?: string) {
    return quote.sendAmount
  },
} satisfies OnchainPayoutUseCase

describe('onchain payout provider port', () => {
  it('lists offers with an identity, fees and limits', async () => {
    const offers = await provider.listOffers()
    expect(offers).toHaveLength(1)
    expect(offers[0].offerId).toBe(offer.offerId)
    expect(offers[0].minAmount).toBeLessThanOrEqual(offers[0].maxAmount)
    expect(Number.isSafeInteger(offers[0].payoutFeeEstimate)).toBe(true)
  })

  it('quotes integer sats and fixed fees', async () => {
    const result = await provider.quote()
    expect(result.sendAmount).toBe(100000)
    expect(result.receiveAmount).toBe(
      result.sendAmount - result.serviceFee - result.networkFee,
    )
    expect(Number.isSafeInteger(result.sweepFee)).toBe(true)
    expect(result.limits.minAmount).toBeLessThanOrEqual(result.sendAmount)
    expect(result.offerRef).toEqual(quote.offerRef)
    expect(result.offerId).toBe(offer.offerId)
    expect(result.identifier).toBe(offer.identifier)
  })

  it('starts with all payment requests, a deadline and no payment yet', async () => {
    const result = await provider.start()
    const total = result.paymentRequests.reduce((sum, item) => sum + item.amount, 0)
    expect(total).toBe(result.sendAmount)
    expect(result.secrets).toBe(startResult.secrets)
    expect(result.deadline.blockHeight).toBe(500000)
  })

  it('resume returns a signed payout without broadcasting it', async () => {
    const result = await provider.resume()
    expect(result.progress.stage).toBe('sweeping')
    expect(result.prepared?.payoutTxId).toBe('payout-tx-1')
    expect(result.prepared?.secrets).not.toBe(startResult.secrets)
  })

  it('publish reports progress after the signed payout is stored', async () => {
    const result = await provider.publish()
    expect(result.stage).toBe('funded')
    expect(result.payoutTxId).toBe('payout-tx-1')
    expect((await provider.status()).currentHeight).toBe(400100)
  })
})

describe('onchain payout store port', () => {
  it('stores the record together with the sealed secrets', async () => {
    await store.create()
    const stored = await store.get()
    expect(stored).toEqual(record)
    expect(await store.readSecrets()).toBe(startResult.secrets)
    expect(stored?.version).toBe(1)
  })

  it('updates only on a matching version', async () => {
    storeVersion = 1
    expect(await store.update(record.id, 1, { stage: 'sweeping' })).toBe(true)
    expect(await store.update(record.id, 0, { stage: 'funded' })).toBe(false)
    expect(
      await store.update(record.id, 2, { secrets: 'sealed-signed', payoutTxId: 'payout-tx-1' }),
    ).toBe(false)
  })

  it('tracks the per-payment lifecycle', () => {
    expect(record.payments.map((payment) => payment.status)).toEqual([
      'dispatched',
      'paid',
    ])
    expect(record.payments.some((payment) => payment.feePaid !== null)).toBe(true)
    expect(record.payments.some((payment) => payment.settledAt !== null)).toBe(true)
  })

  it('lists active and all records', async () => {
    expect(await store.listActive()).toHaveLength(1)
    expect(await store.list()).toHaveLength(1)
  })
})

describe('onchain payout use case port', () => {
  it('is enabled and quotes through Result', async () => {
    expect(useCase.isEnabled()).toBe(true)
    const result = await useCase.quote()
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.receiveAmount).toBe(99000)
    expect(result.ok && result.value.quoteId).toBe('quote-1')
    expect(result.ok && result.value.offerId).toBe(offer.offerId)
    expect(result.ok && result.value.identifier).toBe(offer.identifier)
  })

  it('lists offers through Result', async () => {
    const result = await useCase.listOffers()
    expect(result.ok).toBe(true)
    expect(result.ok && result.value.map((entry) => entry.offerId)).toEqual([offer.offerId])
  })

  it('starts from a stored quote id into the paying stage view', async () => {
    const result = await useCase.start()
    expect(result.ok && result.value.stage).toBe('paying')
    expect(result.ok && result.value.deadline.blockHeight).toBe(500000)
  })

  it('exposes in-flight amount', async () => {
    expect(await useCase.inFlightAmount()).toBe(100000)
    expect(await useCase.inFlightAmount('https://mint.example.com')).toBe(100000)
  })
})

describe('onchain payout errors', () => {
  it.each([
    [new OnchainPayoutUnavailableError('no provider'), 'ONCHAIN_PAYOUT_UNAVAILABLE', true],
    [new OnchainPayoutInvalidDestinationError('bad address'), 'ONCHAIN_PAYOUT_INVALID_DESTINATION', false],
    [new OnchainPayoutProviderRejectedError('bad answer'), 'ONCHAIN_PAYOUT_PROVIDER_REJECTED', true],
    [new OnchainPayoutQuoteExpiredError('old quote'), 'ONCHAIN_PAYOUT_QUOTE_EXPIRED', false],
    [new OnchainPayoutOfferUnavailableError('no offer'), 'ONCHAIN_PAYOUT_OFFER_UNAVAILABLE', true],
  ])('%s carries its code', (error, code, retryable) => {
    expect(error.code).toBe(code)
    expect(error.isRetryable).toBe(retryable)
  })

  it('amount out of range carries the limits', () => {
    const error = new OnchainPayoutAmountOutOfRangeError('too small', 1000, 10000000)
    expect(error.code).toBe('ONCHAIN_PAYOUT_AMOUNT_OUT_OF_RANGE')
    expect(error.isRetryable).toBe(false)
    expect(error.minAmount).toBe(1000)
    expect(error.maxAmount).toBe(10000000)
  })
})

const PORT_FILES = [
  'src/core/ports/driven/onchain-payout-provider.port.ts',
  'src/core/ports/driven/onchain-payout-store.port.ts',
  'src/core/ports/driving/onchain-payout.usecase.ts',
]

const PROTOCOL_WORDS = [
  'electrum',
  'nostr',
  'lockup',
  'htlc',
  'prepay',
  'preimage',
  'invoice',
  'esplora',
  'mempool',
  'bolt11',
  'cashu',
  'nip04',
  'p2wsh',
  'redeemscript',
  'swap',
]

describe('onchain payout ports stay protocol neutral', () => {
  it.each(PORT_FILES)('%s contains no protocol words', (path) => {
    const text = readFileSync(path, 'utf8').toLowerCase()
    expect(PROTOCOL_WORDS.filter((word) => text.includes(word))).toEqual([])
  })
})
