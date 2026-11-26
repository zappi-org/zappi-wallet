import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { Transaction } from '@scure/btc-signer'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  OnchainPayoutAmountOutOfRangeError,
  OnchainPayoutInvalidDestinationError,
  OnchainPayoutOfferUnavailableError,
  OnchainPayoutProviderRejectedError,
  OnchainPayoutQuoteExpiredError,
  OnchainPayoutUnavailableError,
} from '@/core/errors/onchain-payout'
import type {
  OnchainPayoutQuote,
  OnchainPayoutProgress,
} from '@/core/ports/driven/onchain-payout-provider.port'
import type { JsonValue } from '@/core/domain/json'
import type { PayoutChain, ChainOutspend, ChainOutput } from '@/adapters/onchain-payout/electrum/chain-client'
import {
  ElectrumPayoutProvider,
  type ElectrumPayoutProviderOptions,
} from '@/adapters/onchain-payout/electrum/electrum-payout-provider'
import { encryptMessage } from '@/adapters/onchain-payout/electrum/message-crypto'
import { estimatePayout } from '@/core/domain/onchain-payout'
import {
  OFFER_D_TAG,
  OFFER_KIND,
  REQUEST_KIND,
} from '@/adapters/onchain-payout/electrum/offers'
import type { PayoutRelayClient, PayoutRelayEvent } from '@/adapters/onchain-payout/electrum/relay-client'
import { buildSweepTx } from '@/adapters/onchain-payout/electrum/sweep-tx'

interface CreateswapCase {
  id: string
  invoice: string
  minerFeeInvoice: string
  lockupAddress: string
  redeemScript: string
  timeoutBlockHeight: number
  onchainAmount: number
  seed: { preimage: string; claimPrivateKey: string; invoiceAmount: number }
}

interface OfferRow {
  pubkey: string
  pow_nonce: string
  percentage_fee: number
  mining_fee: number
  min_amount: number
  max_forward_amount: number
  max_reverse_amount: number
  relays: string
}

interface Vectors {
  claim_tx: { dest_address: string }
}

const createswap: { cases: CreateswapCase[] } = JSON.parse(
  readFileSync('src/__tests__/fixtures/onchain-payout/createswap.json', 'utf8'),
)
const offersFixture: { offers: OfferRow[] } = JSON.parse(
  readFileSync('src/__tests__/fixtures/onchain-payout/offers.json', 'utf8'),
)
const vectors: Vectors = JSON.parse(
  readFileSync('src/__tests__/fixtures/onchain-payout/vectors.json', 'utf8'),
)

const swapCase = createswap.cases[0]
const secretBytes = hexToBytes(swapCase.seed.preimage)
const claimKeyBytes = hexToBytes(swapCase.seed.claimPrivateKey)
const regtestDestination = vectors.claim_tx.dest_address
const FUNDING_TXID = 'ab'.repeat(32)
const mainnetDestination = JSON.parse(
  readFileSync('src/__tests__/fixtures/onchain-payout/vectors.json', 'utf8'),
).swap_scripts[0].lockup_address as string

class FakeChain implements PayoutChain {
  tip = 129
  rate = 75
  outputs: ChainOutput[] = []
  spends = new Map<string, ChainOutspend>()
  hexes = new Map<string, string>()
  confirmations = new Map<string, number | null>()
  fees = new Map<string, { fee: number; vsize: number }>()
  broadcastCalls: string[] = []

  async tipHeight() {
    return this.tip
  }

  async findOutputs() {
    return this.outputs
  }

  async outspend(txid: string, vout: number) {
    return this.spends.get(`${txid}:${vout}`) ?? { spent: false, confirmedHeight: null }
  }

  async broadcast(hex: string) {
    this.broadcastCalls.push(hex)
    return Transaction.fromRaw(hexToBytes(hex)).id
  }

  async feeRate() {
    return this.rate
  }

  async txConfirmations(txid: string) {
    return this.confirmations.get(txid) ?? null
  }

  async txFee(txid: string) {
    const fee = this.fees.get(txid)
    if (fee === undefined) throw new Error('unknown transaction fee')
    return fee
  }

  async txHex(txid: string) {
    const hex = this.hexes.get(txid)
    if (!hex) throw new Error('unknown transaction')
    return hex
  }
}

interface FakeRelay {
  client: PayoutRelayClient
  serverPubkey: string
  serverSecret: Uint8Array
  offerEvents: PayoutRelayEvent[]
  queries: Record<string, unknown>[]
  requestEvents: PayoutRelayEvent[]
}

function createFakeRelay(
  options: {
    offerEvents?: PayoutRelayEvent[]
    response?: () => Record<string, unknown>
  } = {},
): FakeRelay {
  const serverSecret = generateSecretKey()
  const serverPubkey = getPublicKey(serverSecret)
  let handler: ((event: PayoutRelayEvent) => void) | null = null
  const state: FakeRelay = {
    serverPubkey,
    serverSecret,
    offerEvents: options.offerEvents ?? [],
    queries: [],
    requestEvents: [],
    client: {
      async query(_relays, filter) {
        state.queries.push(filter)
        return state.offerEvents
      },
      async publish(_relays, event) {
        state.requestEvents.push(event)
        if (!options.response || !handler) return
        handler({
          id: 'reply-1',
          pubkey: serverPubkey,
          kind: REQUEST_KIND,
          created_at: 0,
          tags: [],
          content: encryptMessage(
            bytesToHex(serverSecret),
            event.pubkey,
            JSON.stringify({ reply_to: event.id, ...options.response() }),
          ),
          sig: '00',
        })
      },
      subscribe(_relays, _filter, onEvent) {
        handler = onEvent
        return () => {
          handler = null
        }
      },
      close() {},
    },
  }
  return state
}

function offerIdFor(row: OfferRow): string {
  return `${row.pubkey}:offer-${row.pubkey.slice(0, 8)}`
}

function offerEvent(row: OfferRow, createdAt: number): PayoutRelayEvent {
  return {
    id: `offer-${row.pubkey.slice(0, 8)}`,
    pubkey: row.pubkey,
    kind: OFFER_KIND,
    created_at: createdAt,
    tags: [
      ['d', OFFER_D_TAG],
      ['r', 'net:mainnet'],
    ],
    content: JSON.stringify({
      pow_nonce: row.pow_nonce,
      percentage_fee: row.percentage_fee,
      mining_fee: row.mining_fee,
      min_amount: row.min_amount,
      max_forward_amount: row.max_forward_amount,
      max_reverse_amount: row.max_reverse_amount,
      relays: row.relays,
    }),
    sig: '00',
  }
}

function sequenceRandomBytes(values: Uint8Array[]): (length: number) => Uint8Array {
  let index = 0
  return (length: number) => {
    const value = values[index] ?? new Uint8Array(length).fill(7)
    index += 1
    return value.slice(0, length)
  }
}

const invoiceNow = 1_700_000_000
const invoiceNowMs = invoiceNow * 1000

function responseWith(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: swapCase.id,
    invoice: swapCase.invoice,
    minerFeeInvoice: swapCase.minerFeeInvoice,
    lockupAddress: swapCase.lockupAddress,
    redeemScript: swapCase.redeemScript,
    timeoutBlockHeight: swapCase.timeoutBlockHeight,
    onchainAmount: swapCase.onchainAmount,
    ...patch,
  }
}

function makeQuote(serverPubkey: string, patch: Partial<OnchainPayoutQuote> = {}): OnchainPayoutQuote {
  return {
    providerId: 'electrum',
    offerId: offerIdFor(offersFixture.offers[0]),
    identifier: 'npub1fixture',
    destination: regtestDestination,
    sendAmount: 100000,
    receiveAmount: 66800,
    serviceFee: 300,
    networkFee: 22600,
    sweepFee: 10200,
    limits: { minAmount: 20000, maxAmount: 2000000 },
    estimatedMinutes: 1,
    offerRef: {
      pubkey: serverPubkey,
      feePercent: 0.49,
      networkFee: 22600,
      relays: ['wss://fake.example'],
      feeRate: 75,
      sweepVsize: 136,
    },
    expiresAt: invoiceNowMs + 60000,
    ...patch,
  }
}

function makeProvider(
  chain: FakeChain,
  relay: FakeRelay,
  options: Partial<ElectrumPayoutProviderOptions> = {},
): ElectrumPayoutProvider {
  return new ElectrumPayoutProvider({
    network: 'regtest',
    relayClient: relay.client,
    chain,
    relays: ['wss://our.example'],
    appLimits: { minAmount: 20000, maxAmount: 2000000 },
    now: () => invoiceNowMs,
    randomBytes: sequenceRandomBytes([secretBytes, claimKeyBytes]),
    quoteTtlMs: 60000,
    offerCacheMs: 0,
    offerWaitMs: 1,
    requestTimeoutMs: 1000,
    sweepTargetBlocks: 2,
    ...options,
  })
}

async function startPayout(chain: FakeChain, relay: FakeRelay) {
  const provider = makeProvider(chain, relay)
  const quote = makeQuote(relay.serverPubkey)
  const started = await provider.start({ quote })
  return { provider, started }
}

function fundingOutput(patch: Partial<ChainOutput> = {}): ChainOutput {
  return { txid: FUNDING_TXID, vout: 0, value: swapCase.onchainAmount, confirmedHeight: 100, ...patch }
}

function sweepSecrets(
  secrets: string,
  sweeps: { txid: string; hex: string; fee: number; feeRate: number; createdAtHeight: number }[],
): string {
  const parsed = JSON.parse(secrets)
  parsed.sweeps = sweeps
  return JSON.stringify(parsed)
}

function expectNoBroadcast(chain: FakeChain) {
  expect(chain.broadcastCalls).toEqual([])
}

describe('electrum payout provider offers', () => {
  const nowSeconds = 1_700_000_000

  function listProvider(
    relay: FakeRelay,
    options: Partial<ElectrumPayoutProviderOptions> = {},
  ) {
    const chain = new FakeChain()
    chain.rate = 2
    return new ElectrumPayoutProvider({
      network: 'mainnet',
      relayClient: relay.client,
      chain,
      relays: ['wss://our.example'],
      appLimits: { minAmount: 20000, maxAmount: 2000000 },
      now: () => 1_700_000_000_000,
      offerCacheMs: 60000,
      offerWaitMs: 1,
      ...options,
    })
  }

  function fixtureRelay(): FakeRelay {
    return createFakeRelay({
      offerEvents: [
        offerEvent(offersFixture.offers[0], nowSeconds - 60),
        offerEvent(offersFixture.offers[1], nowSeconds - 60),
      ],
    })
  }

  it('lists the offers cheapest first with identity, fees and limits', async () => {
    const offers = await listProvider(fixtureRelay()).listOffers()
    expect(offers).toHaveLength(2)
    expect(offers[0]).toMatchObject({
      offerId: offerIdFor(offersFixture.offers[1]),
      feePercent: 0.3,
      networkFee: 150,
      payoutFeeRate: 2,
      payoutFeeEstimate: 272,
      minAmount: 20000,
      maxAmount: 2000000,
      seenAt: (nowSeconds - 60) * 1000,
    })
    expect(offers[0].identifier.startsWith('npub1')).toBe(true)
    expect(offers[1].identifier.startsWith('npub1')).toBe(true)
    expect(offers[0].identifier).not.toBe(offers[1].identifier)
  })

  it('intersects the limits with the app range', async () => {
    const offers = await listProvider(fixtureRelay(), {
      appLimits: { minAmount: 30000, maxAmount: 1000000 },
    }).listOffers()
    expect(offers.map((offer) => ({ minAmount: offer.minAmount, maxAmount: offer.maxAmount }))).toEqual([
      { minAmount: 30000, maxAmount: 1000000 },
      { minAmount: 30000, maxAmount: 1000000 },
    ])
  })

  it('drops offers whose range is empty after the app limits', async () => {
    const offers = await listProvider(fixtureRelay(), {
      appLimits: { minAmount: 20000, maxAmount: 10000 },
    }).listOffers()
    expect(offers).toEqual([])
  })

  it('lists nothing when no announcement passes validation', async () => {
    const relay = createFakeRelay({
      offerEvents: [offerEvent(offersFixture.offers[0], nowSeconds - 7200)],
    })
    expect(await listProvider(relay).listOffers()).toEqual([])
  })

  it('agrees with the quote for every destination shape', async () => {
    const provider = listProvider(fixtureRelay())
    const [offer] = await provider.listOffers()
    const sendAmount = 100000
    const destinations = [
      ['bc1qqurswpc8qurswpc8qurswpc8qurswpc89fe3yv', 272],
      ['bc1pqurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurswpc8qurssvw8hu', 296],
      ['1eA9ctCNq41iLLnQErtTUVdxpRyZ9hZmW', 278],
    ] as const
    expect(offer.payoutFeeEstimate).toBe(272)
    for (const [destination, sweepFee] of destinations) {
      const quote = await provider.quote({
        offerId: offer.offerId,
        sendAmount,
        destination,
      })
      expect(quote.sweepFee).toBe(sweepFee)
      const estimate = estimatePayout({
        feePercent: offer.feePercent,
        networkFee: offer.networkFee,
        payoutFeeRate: offer.payoutFeeRate,
        destination,
        sendAmount,
      })
      expect(estimate).toEqual({
        sendAmount: quote.sendAmount,
        receiveAmount: quote.receiveAmount,
        serviceFee: quote.serviceFee,
        networkFee: quote.networkFee,
        payoutFee: quote.sweepFee,
      })
      expect(
        estimatePayout({
          feePercent: offer.feePercent,
          networkFee: offer.networkFee,
          payoutFeeRate: offer.payoutFeeRate,
          destination,
          receiveAmount: quote.receiveAmount,
        }).sendAmount,
      ).toBe(sendAmount)
    }
  })

  it('keeps the cached offers when a forced refresh comes back empty', async () => {
    const relay = fixtureRelay()
    const provider = listProvider(relay)
    const offers = await provider.listOffers()
    expect(offers).toHaveLength(2)
    relay.offerEvents = []
    await expect(
      provider.quote({
        offerId: 'unknown-offer',
        sendAmount: 100000,
        destination: mainnetDestination,
      }),
    ).rejects.toBeInstanceOf(OnchainPayoutOfferUnavailableError)
    expect(relay.queries).toHaveLength(2)
    expect(await provider.listOffers()).toEqual(offers)
    expect(relay.queries).toHaveLength(2)
  })

  it('caches the announcements for the cache window', async () => {
    const relay = fixtureRelay()
    let clock = 1_700_000_000_000
    const provider = listProvider(relay, { now: () => clock })
    await provider.listOffers()
    await provider.listOffers()
    expect(relay.queries).toHaveLength(1)
    clock += 61_000
    await provider.listOffers()
    expect(relay.queries).toHaveLength(2)
  })
})

describe('electrum payout provider quote', () => {
  function mainnetProvider(
    relay: FakeRelay,
    chain = new FakeChain(),
    options: Partial<ElectrumPayoutProviderOptions> = {},
  ) {
    chain.rate = 2
    return new ElectrumPayoutProvider({
      network: 'mainnet',
      relayClient: relay.client,
      chain,
      relays: ['wss://our.example'],
      appLimits: { minAmount: 20000, maxAmount: 2000000 },
      now: () => 1_700_000_000_000,
      offerCacheMs: 60000,
      offerWaitMs: 1,
      ...options,
    })
  }

  const nowSeconds = 1_700_000_000

  it('quotes the chosen offer and prices the payout', async () => {
    const relay = createFakeRelay({
      offerEvents: [
        offerEvent(offersFixture.offers[0], nowSeconds - 60),
        offerEvent(offersFixture.offers[1], nowSeconds - 60),
      ],
    })
    const quote = await mainnetProvider(relay).quote({
      offerId: offerIdFor(offersFixture.offers[1]),
      sendAmount: 100000,
      destination: mainnetDestination,
    })
    expect(quote.offerId).toBe(offerIdFor(offersFixture.offers[1]))
    expect(quote.identifier.startsWith('npub1')).toBe(true)
    expect(quote.networkFee).toBe(150)
    expect(quote.sweepFee).toBe(296)
    expect(quote.receiveAmount).toBe(99550 - 296)
    expect(quote.serviceFee).toBe(300)
    expect(quote.estimatedMinutes).toBe(30)
    expect(quote.limits).toEqual({ minAmount: 20000, maxAmount: 2000000 })
    expect(quote.expiresAt).toBe(1_700_000_000_000 + 60000)
    expect(quote.offerRef).toMatchObject({ feePercent: 0.3, sweepVsize: 148, feeRate: 2 })
  })

  it('quotes the other offer at its own rate', async () => {
    const relay = createFakeRelay({
      offerEvents: [
        offerEvent(offersFixture.offers[0], nowSeconds - 60),
        offerEvent(offersFixture.offers[1], nowSeconds - 60),
      ],
    })
    const quote = await mainnetProvider(relay).quote({
      offerId: offerIdFor(offersFixture.offers[0]),
      sendAmount: 100000,
      destination: mainnetDestination,
    })
    expect(quote.networkFee).toBe(150)
    expect(quote.serviceFee).toBe(490)
    expect(quote.offerRef).toMatchObject({ feePercent: 0.49 })
  })

  it('caches offers between quotes', async () => {
    const relay = createFakeRelay({
      offerEvents: [offerEvent(offersFixture.offers[0], nowSeconds - 60)],
    })
    const provider = mainnetProvider(relay)
    const offerId = offerIdFor(offersFixture.offers[0])
    await provider.quote({ offerId, sendAmount: 100000, destination: mainnetDestination })
    await provider.quote({ offerId, sendAmount: 100000, destination: mainnetDestination })
    expect(relay.queries).toHaveLength(1)
  })

  it('refreshes once when the chosen offer is not in the cache', async () => {
    const relay = createFakeRelay({
      offerEvents: [offerEvent(offersFixture.offers[0], nowSeconds - 60)],
    })
    const provider = mainnetProvider(relay)
    await provider.listOffers()
    relay.offerEvents = [
      offerEvent(offersFixture.offers[0], nowSeconds - 60),
      offerEvent(offersFixture.offers[1], nowSeconds - 60),
    ]
    const quote = await provider.quote({
      offerId: offerIdFor(offersFixture.offers[1]),
      sendAmount: 100000,
      destination: mainnetDestination,
    })
    expect(quote.offerId).toBe(offerIdFor(offersFixture.offers[1]))
    expect(relay.queries).toHaveLength(2)
  })

  it('rejects an unknown offer after a single refresh', async () => {
    const relay = createFakeRelay({
      offerEvents: [offerEvent(offersFixture.offers[0], nowSeconds - 60)],
    })
    const provider = mainnetProvider(relay)
    await expect(
      provider.quote({
        offerId: 'unknown-offer',
        sendAmount: 100000,
        destination: mainnetDestination,
      }),
    ).rejects.toBeInstanceOf(OnchainPayoutOfferUnavailableError)
    expect(relay.queries).toHaveLength(2)
  })

  it('reports the limits when no offer serves the amount', async () => {
    const relay = createFakeRelay({
      offerEvents: [offerEvent(offersFixture.offers[0], nowSeconds - 60)],
    })
    const error = await mainnetProvider(relay)
      .quote({
        offerId: offerIdFor(offersFixture.offers[0]),
        sendAmount: 1000,
        destination: mainnetDestination,
      })
      .catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(OnchainPayoutAmountOutOfRangeError)
    expect(error).toMatchObject({ minAmount: 20000, maxAmount: 2000000 })
  })

  it('rejects an invalid destination', async () => {
    const relay = createFakeRelay({
      offerEvents: [offerEvent(offersFixture.offers[0], nowSeconds - 60)],
    })
    await expect(
      mainnetProvider(relay).quote({
        offerId: offerIdFor(offersFixture.offers[0]),
        sendAmount: 100000,
        destination: 'not-an-address',
      }),
    ).rejects.toBeInstanceOf(OnchainPayoutInvalidDestinationError)
  })

  it('honours a custom pow target', async () => {
    const relay = createFakeRelay({
      offerEvents: [offerEvent(offersFixture.offers[0], nowSeconds - 60)],
    })
    const offerId = offerIdFor(offersFixture.offers[0])
    const strict = mainnetProvider(relay, new FakeChain(), { powTargetBits: 54 })
    await expect(
      strict.quote({ offerId, sendAmount: 100000, destination: mainnetDestination }),
    ).rejects.toBeInstanceOf(OnchainPayoutUnavailableError)

    const relaxed = mainnetProvider(relay, new FakeChain(), { powTargetBits: 53 })
    const quote = await relaxed.quote({
      offerId,
      sendAmount: 100000,
      destination: mainnetDestination,
    })
    expect(quote.networkFee).toBe(150)
  })

  it('reports unavailability without offers', async () => {
    const relay = createFakeRelay({ offerEvents: [] })
    await expect(
      mainnetProvider(relay).quote({
        offerId: offerIdFor(offersFixture.offers[0]),
        sendAmount: 100000,
        destination: mainnetDestination,
      }),
    ).rejects.toBeInstanceOf(OnchainPayoutUnavailableError)
  })
})

describe('electrum payout provider start', () => {
  it('returns both payment requests and secrets without leaking them', async () => {
    const chain = new FakeChain()
    const relay = createFakeRelay({ response: () => responseWith() })
    const { started } = await startPayout(chain, relay)

    expect(started.paymentRequests.map((request) => request.amount)).toEqual([45000, 55000])
    expect(started.sendAmount).toBe(100000)
    expect(started.receiveAmount).toBe(swapCase.onchainAmount - 10200)
    expect(started.deadline.blockHeight).toBe(swapCase.timeoutBlockHeight)
    expect(started.deadline.estimatedAt).toBe(
      invoiceNowMs + (swapCase.timeoutBlockHeight - 129) * 600000,
    )

    const secrets = JSON.parse(started.secrets)
    expect(secrets.secret).toBe(swapCase.seed.preimage)
    expect(secrets.claimKey).toBe(swapCase.seed.claimPrivateKey)
    expect(secrets.sweeps).toEqual([])

    const refJson = JSON.stringify(started.providerRef)
    expect(refJson).not.toContain(swapCase.seed.preimage)
    expect(refJson).not.toContain(swapCase.seed.claimPrivateKey)
    expect(started.providerRef).toMatchObject({
      v: 1,
      network: 'regtest',
      serverPubkey: relay.serverPubkey,
      serverId: swapCase.id,
    })
    expectNoBroadcast(chain)
  })

  it('rejects a quote that expired', async () => {
    const chain = new FakeChain()
    const relay = createFakeRelay({ response: () => responseWith() })
    const provider = makeProvider(chain, relay)
    const quote = makeQuote(relay.serverPubkey, { expiresAt: invoiceNowMs - 1 })
    await expect(provider.start({ quote })).rejects.toBeInstanceOf(OnchainPayoutQuoteExpiredError)
  })

  it('rejects a tampered response without creating requests', async () => {
    const chain = new FakeChain()
    const relay = createFakeRelay({
      response: () => responseWith({ onchainAmount: swapCase.onchainAmount + 50000 }),
    })
    const provider = makeProvider(chain, relay, {
      randomBytes: sequenceRandomBytes([new Uint8Array(32).fill(9), claimKeyBytes]),
    })
    await expect(provider.start({ quote: makeQuote(relay.serverPubkey) })).rejects.toBeInstanceOf(
      OnchainPayoutProviderRejectedError,
    )
    expectNoBroadcast(chain)
  })

  it('rejects a response with another payment hash', async () => {
    const chain = new FakeChain()
    const relay = createFakeRelay({ response: () => responseWith() })
    const provider = makeProvider(chain, relay, {
      randomBytes: sequenceRandomBytes([new Uint8Array(32).fill(9), claimKeyBytes]),
    })
    await expect(provider.start({ quote: makeQuote(relay.serverPubkey) })).rejects.toBeInstanceOf(
      OnchainPayoutProviderRejectedError,
    )
  })
})

describe('electrum payout provider resume', () => {
  async function prepared() {
    const chain = new FakeChain()
    const relay = createFakeRelay({ response: () => responseWith() })
    const { provider, started } = await startPayout(chain, relay)
    return { chain, provider, providerRef: started.providerRef, secrets: started.secrets }
  }

  it('waits as paying while nothing is funded', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = []
    chain.rate = 2
    const advance = await provider.resume({ providerRef, secrets, stage: 'paying', published: false })
    expect(advance.progress).toEqual({ stage: 'paying', currentHeight: 129 })
    expect(advance.prepared).toBeUndefined()
    expectNoBroadcast(chain)
  })

  it('marks funded while the funding is unconfirmed', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput({ confirmedHeight: null })]
    chain.rate = 2
    const advance = await provider.resume({ providerRef, secrets, stage: 'paying', published: false })
    expect(advance.progress.stage).toBe('funded')
    expect(advance.prepared).toBeUndefined()
    expectNoBroadcast(chain)
  })

  it('prepares a sweep without broadcasting it', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const advance = await provider.resume({ providerRef, secrets, stage: 'funded', published: false })
    expect(advance.progress.stage).toBe('sweeping')
    expect(advance.prepared?.secrets).toBeTruthy()
    expectNoBroadcast(chain)

    const sweeps = JSON.parse(advance.prepared?.secrets ?? '{}').sweeps
    expect(sweeps).toHaveLength(1)
    expect(sweeps[0].txid).toBe(advance.progress.payoutTxId)
    expect(sweeps[0].fee).toBe(272)
    expect(sweeps[0].feeRate).toBe(2)
    expect(sweeps[0].createdAtHeight).toBe(129)
  })

  it('keeps sweeping after the reveal even when the sweep is dropped', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const first = await provider.resume({ providerRef, secrets, stage: 'funded', published: false })
    const again = await provider.resume({
      providerRef,
      secrets: first.prepared?.secrets ?? '',
      stage: 'sweeping',
      published: true,
    })
    expect(again.progress.stage).toBe('sweeping')
    expect(again.progress.payoutTxId).toBe(first.progress.payoutTxId)
    expect(again.prepared).toBeUndefined()
    expectNoBroadcast(chain)
  })

  it('bumps the fee when the chain fee rate rose', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const first = await provider.resume({ providerRef, secrets, stage: 'funded', published: false })
    chain.rate = 3
    chain.tip = 130
    const bumped = await provider.resume({
      providerRef,
      secrets: first.prepared?.secrets ?? '',
      stage: 'sweeping',
      published: true,
    })
    expect(bumped.prepared?.payoutTxId).toBeTruthy()
    expect(bumped.progress.payoutTxId).toBe(bumped.prepared?.payoutTxId)
    const sweeps = JSON.parse(bumped.prepared?.secrets ?? '{}').sweeps
    expect(sweeps).toHaveLength(2)
    expect(sweeps[1].fee).toBe(Math.max(408, 272 + 136))
    expectNoBroadcast(chain)
  })

  it('clamps a huge bump to the reveal cap', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const first = await provider.resume({ providerRef, secrets, stage: 'funded', published: false })
    chain.rate = 1000
    chain.tip = 130
    const attempt = await provider.resume({
      providerRef,
      secrets: first.prepared?.secrets ?? '',
      stage: 'sweeping',
      published: true,
    })
    const sweeps = JSON.parse(attempt.prepared?.secrets ?? '{}').sweeps
    expect(sweeps[1].fee).toBe(swapCase.onchainAmount - 330)
    expect(sweeps[1].fee).toBeGreaterThan(7700)
  })

  it('bumps only once per block near the locktime', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const first = await provider.resume({ providerRef, secrets, stage: 'funded', published: false })
    chain.tip = swapCase.timeoutBlockHeight - 10
    const bumped = await provider.resume({
      providerRef,
      secrets: first.prepared?.secrets ?? '',
      stage: 'sweeping',
      published: true,
    })
    expect(bumped.prepared).toBeTruthy()
    const again = await provider.resume({
      providerRef,
      secrets: bumped.prepared?.secrets ?? '',
      stage: 'sweeping',
      published: true,
    })
    expect(again.prepared).toBeUndefined()
    expect(again.progress.payoutTxId).toBe(bumped.progress.payoutTxId)
  })

  it('does not replace the same conflict twice', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const first = await provider.resume({ providerRef, secrets, stage: 'funded', published: false })
    chain.spends.set(`${FUNDING_TXID}:0`, {
      spent: true,
      txid: 'provider-tx',
      confirmedHeight: null,
    })
    chain.fees.set('provider-tx', { fee: 6400, vsize: 128 })
    const replaced = await provider.resume({
      providerRef,
      secrets: first.prepared?.secrets ?? '',
      stage: 'sweeping',
      published: true,
    })
    expect(replaced.prepared).toBeTruthy()
    const repeated = await provider.resume({
      providerRef,
      secrets: replaced.prepared?.secrets ?? '',
      stage: 'sweeping',
      published: true,
    })
    expect(repeated.prepared).toBeUndefined()
  })

  it('refunds when the provider spends the funding', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.spends.set(`${FUNDING_TXID}:0`, { spent: true, txid: 'provider-tx', confirmedHeight: 101 })
    const advance = await provider.resume({ providerRef, secrets, stage: 'funded', published: false })
    expect(advance.progress).toEqual({
      stage: 'refunded',
      currentHeight: 129,
      failureReason: 'spent_by_provider',
    })
  })

  it('completes when our sweep confirms', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.spends.set(`${FUNDING_TXID}:0`, { spent: true, txid: 'our-tx', confirmedHeight: 120 })
    chain.confirmations.set('our-tx', 4)
    const withSweep = sweepSecrets(secrets, [
      { txid: 'our-tx', hex: '00', fee: 272, feeRate: 2, createdAtHeight: 120 },
    ])
    const advance = await provider.resume({ providerRef, secrets: withSweep, stage: 'sweeping', published: true })
    expect(advance.progress).toEqual({
      stage: 'completed',
      currentHeight: 129,
      payoutTxId: 'our-tx',
      confirmations: 4,
    })
  })

  it('aborts once the locktime passed without funding', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = []
    chain.tip = swapCase.timeoutBlockHeight
    const advance = await provider.resume({ providerRef, secrets, stage: 'paying', published: false })
    expect(advance.progress).toMatchObject({ stage: 'aborted', failureReason: 'expired' })
  })

  it('stops sweeping near the locktime', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.tip = swapCase.timeoutBlockHeight - 30
    const advance = await provider.resume({ providerRef, secrets, stage: 'funded', published: false })
    expect(advance.progress).toMatchObject({
      stage: 'funded',
      failureReason: 'too_close_to_locktime',
    })
    expect(advance.prepared).toBeUndefined()
  })

  it('treats an unknown spender holding our secret as ours', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    const funding = fundingOutput()
    chain.outputs = [funding]
    chain.rate = 2
    const external = buildSweepTx({
      fundingTxId: funding.txid,
      fundingVout: funding.vout,
      fundingValue: funding.value,
      script: hexToBytes(swapCase.redeemScript),
      secret: secretBytes,
      claimSecretKey: claimKeyBytes,
      destination: regtestDestination,
      fee: 272,
      maxFee: 7700,
      fundingConfirmations: 1,
      network: 'regtest',
    })
    chain.hexes.set(external.txid, external.hex)
    chain.spends.set(`${FUNDING_TXID}:0`, {
      spent: true,
      txid: external.txid,
      confirmedHeight: null,
    })
    const advance = await provider.resume({ providerRef, secrets, stage: 'funded', published: false })
    expect(advance.progress.stage).toBe('sweeping')
    expect(advance.progress.payoutTxId).toBe(external.txid)
  })

  it('refuses to build a sweep above the fee cap before the reveal', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.rate = 1000
    const advance = await provider.resume({
      providerRef,
      secrets,
      stage: 'funded',
      published: false,
    })
    expect(advance.progress).toMatchObject({ stage: 'funded', failureReason: 'fee_too_high' })
    expect(advance.prepared).toBeUndefined()
    expectNoBroadcast(chain)
  })

  it('drops an unpublished sweep once the funding is too close to the locktime', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const first = await provider.resume({
      providerRef,
      secrets,
      stage: 'funded',
      published: false,
    })
    chain.tip = swapCase.timeoutBlockHeight - 10
    const advance = await provider.resume({
      providerRef,
      secrets: first.prepared?.secrets ?? '',
      stage: 'funded',
      published: false,
    })
    expect(advance.progress).toMatchObject({
      stage: 'funded',
      failureReason: 'too_close_to_locktime',
    })
    expect(advance.prepared).toBeUndefined()
  })

  it('replaces a provider mempool refund with a higher absolute fee', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const first = await provider.resume({
      providerRef,
      secrets,
      stage: 'funded',
      published: false,
    })
    chain.spends.set(`${FUNDING_TXID}:0`, {
      spent: true,
      txid: 'provider-tx',
      confirmedHeight: null,
    })
    chain.fees.set('provider-tx', { fee: 6400, vsize: 128 })
    const advance = await provider.resume({
      providerRef,
      secrets: first.prepared?.secrets ?? '',
      stage: 'sweeping',
      published: true,
    })
    const sweeps = JSON.parse(advance.prepared?.secrets ?? '{}').sweeps
    expect(sweeps).toHaveLength(2)
    expect(sweeps[1].fee).toBe(6936)
    expect(sweeps[1].fee).toBeGreaterThan(6400 + 136)
    expect(sweeps[1].fee / 136).toBeGreaterThan(6400 / 128)
    expect(sweeps[1].replaces).toBe('provider-tx')
    expect(advance.progress.payoutTxId).toBe(sweeps[1].txid)
    expectNoBroadcast(chain)
  })

  it('allows a post-reveal bump above the pre-reveal fee cap', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const first = await provider.resume({
      providerRef,
      secrets,
      stage: 'funded',
      published: false,
    })
    chain.rate = 60
    chain.tip = 130
    const advance = await provider.resume({
      providerRef,
      secrets: first.prepared?.secrets ?? '',
      stage: 'sweeping',
      published: true,
    })
    const sweeps = JSON.parse(advance.prepared?.secrets ?? '{}').sweeps
    expect(sweeps[1].fee).toBe(136 * 60)
    expect(sweeps[1].fee).toBeGreaterThan(7700)
  })

  it('builds a fresh sweep when a better funding output appears', async () => {
    const { chain, provider, providerRef, secrets } = await prepared()
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const first = await provider.resume({
      providerRef,
      secrets,
      stage: 'funded',
      published: false,
    })
    const movedFunding = fundingOutput({ txid: 'cd'.repeat(32) })
    chain.outputs = [movedFunding]
    const advance = await provider.resume({
      providerRef,
      secrets: first.prepared?.secrets ?? '',
      stage: 'sweeping',
      published: true,
    })
    const sweeps = JSON.parse(advance.prepared?.secrets ?? '{}').sweeps
    expect(sweeps).toHaveLength(2)
    expect(sweeps[1].fee).toBe(272 + 136)
    const movedHex = sweeps[1].hex as string
    expect(movedHex).toBeTruthy()
  })

  it('refuses malformed references', async () => {
    const { chain, provider, secrets } = await prepared()
    await expect(
      provider.resume({ providerRef: { v: 99 } as JsonValue, secrets, stage: 'funded', published: false }),
    ).rejects.toThrow()
    await expect(
      provider.resume({ providerRef: {} as JsonValue, secrets: 'not json', stage: 'funded', published: false }),
    ).rejects.toThrow()
    expectNoBroadcast(chain)
  })
})

describe('electrum payout provider publish and status', () => {
  async function prepared() {
    const chain = new FakeChain()
    const relay = createFakeRelay({ response: () => responseWith() })
    const { provider, started } = await startPayout(chain, relay)
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const advance = await provider.resume({
      providerRef: started.providerRef,
      secrets: started.secrets,
      stage: 'funded',
      published: false,
    })
    return { chain, provider, providerRef: started.providerRef, advance }
  }

  it('publishes exactly the last signed sweep', async () => {
    const { chain, provider, providerRef, advance } = await prepared()
    const secrets = advance.prepared?.secrets ?? ''
    const progress = await provider.publish({ providerRef, secrets })
    expect(progress.stage).toBe('sweeping')
    expect(progress.payoutTxId).toBe(advance.progress.payoutTxId)
    expect(chain.broadcastCalls).toEqual([JSON.parse(secrets).sweeps[0].hex])
    expect(chain.broadcastCalls).toHaveLength(1)
  })

  it('refuses to publish without a signed sweep', async () => {
    const chain = new FakeChain()
    const relay = createFakeRelay({ response: () => responseWith() })
    const { provider, started } = await startPayout(chain, relay)
    await expect(
      provider.publish({ providerRef: started.providerRef, secrets: started.secrets }),
    ).rejects.toThrow('payout has no signed sweep to publish')
  })

  it('reports funded while the funding is unconfirmed', async () => {
    const chain = new FakeChain()
    const relay = createFakeRelay({ response: () => responseWith() })
    const { provider, started } = await startPayout(chain, relay)
    chain.outputs = [fundingOutput({ confirmedHeight: null })]
    const progress = await provider.status({
      providerRef: started.providerRef,
      stage: 'paying',
      published: false,
    })
    expect(progress.stage).toBe('funded')
  })

  it('never signs or broadcasts from status', async () => {
    const chain = new FakeChain()
    const relay = createFakeRelay({ response: () => responseWith() })
    const { provider, started } = await startPayout(chain, relay)
    chain.outputs = [fundingOutput()]
    chain.rate = 2
    const progress: OnchainPayoutProgress = await provider.status({
      providerRef: started.providerRef,
      stage: 'funded',
      published: false,
    })
    expect(progress.stage).toBe('funded')
    expectNoBroadcast(chain)
  })

  it('recognizes our revealed spend without secrets', async () => {
    const { chain, provider, providerRef } = await prepared()
    const funding = fundingOutput()
    const revealed = buildSweepTx({
      fundingTxId: funding.txid,
      fundingVout: funding.vout,
      fundingValue: funding.value,
      script: hexToBytes(swapCase.redeemScript),
      secret: secretBytes,
      claimSecretKey: claimKeyBytes,
      destination: regtestDestination,
      fee: 272,
      maxFee: 7700,
      fundingConfirmations: 1,
      network: 'regtest',
    })
    chain.spends.set(`${FUNDING_TXID}:0`, {
      spent: true,
      txid: revealed.txid,
      confirmedHeight: null,
    })
    chain.hexes.set(revealed.txid, revealed.hex)
    const progress = await provider.status({ providerRef, stage: 'sweeping', published: true })
    expect(progress.stage).toBe('sweeping')
    expectNoBroadcast(chain)
  })

  it('keeps sweeping for an unconfirmed provider spend once published', async () => {
    const { chain, provider, providerRef } = await prepared()
    chain.spends.set(`${FUNDING_TXID}:0`, {
      spent: true,
      txid: 'provider-tx',
      confirmedHeight: null,
    })
    const progress = await provider.status({ providerRef, stage: 'sweeping', published: true })
    expect(progress.stage).toBe('sweeping')
  })

  it('never refunds before the provider spend confirms', async () => {
    const { chain, provider, providerRef } = await prepared()
    chain.spends.set(`${FUNDING_TXID}:0`, {
      spent: true,
      txid: 'provider-tx',
      confirmedHeight: null,
    })
    const progress = await provider.status({ providerRef, stage: 'funded', published: false })
    expect(progress).toMatchObject({ stage: 'funded', failureReason: 'spent_by_provider' })
  })

  it('reports a confirmed provider refund even while sweeping', async () => {
    const { chain, provider, providerRef } = await prepared()
    chain.spends.set(`${FUNDING_TXID}:0`, {
      spent: true,
      txid: 'provider-tx',
      confirmedHeight: 101,
    })
    const progress = await provider.status({ providerRef, stage: 'sweeping', published: true })
    expect(progress).toMatchObject({ stage: 'refunded', failureReason: 'spent_by_provider' })
  })
})
