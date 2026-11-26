import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  checkPayoutCosts,
  checkUpfront,
  OFFER_D_TAG,
  OFFER_KIND,
  offerIdOf,
  offerNetworkTag,
  offerPowBits,
  offerRange,
  parseOffers,
  selectPayoutOffers,
  type PayoutOffer,
} from '@/adapters/onchain-payout/electrum/offers'
import type { PayoutRelayEvent } from '@/adapters/onchain-payout/electrum/relay-client'

interface OfferRow {
  pubkey: string
  pow_nonce: string
  percentage_fee: number
  mining_fee: number
  min_amount: number
  max_forward_amount: number
  max_reverse_amount: number
  relays: string
  age: number
  pow_bits: number
}

const fixture: { offers: OfferRow[] } = JSON.parse(
  readFileSync('src/__tests__/fixtures/onchain-payout/offers.json', 'utf8'),
)

const now = 1700000000
const appLimits = { appMinAmount: 20000, appMaxAmount: 2000000 }

function contentOf(row: OfferRow, patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    pow_nonce: row.pow_nonce,
    percentage_fee: row.percentage_fee,
    mining_fee: row.mining_fee,
    min_amount: row.min_amount,
    max_forward_amount: row.max_forward_amount,
    max_reverse_amount: row.max_reverse_amount,
    relays: row.relays,
    ...patch,
  })
}

function makeEvent(
  row: OfferRow,
  patch: {
    content?: string
    created_at?: number
    network?: string
    dTag?: string
    pubkey?: string
  } = {},
): PayoutRelayEvent {
  return {
    id: `event-${row.pubkey.slice(0, 8)}`,
    pubkey: patch.pubkey ?? row.pubkey,
    kind: OFFER_KIND,
    created_at: patch.created_at ?? now - row.age,
    tags: [
      ['d', patch.dTag ?? OFFER_D_TAG],
      ['r', patch.network ?? 'net:mainnet'],
    ],
    content: patch.content ?? contentOf(row),
    sig: '00',
  }
}

const parse = { network: 'mainnet' as const, now, powTarget: 30 }

function offerOf(patch: Partial<PayoutOffer> = {}): PayoutOffer {
  return {
    eventId: 'event-1',
    pubkey: 'ab'.repeat(32),
    feePercent: 0.5,
    networkFee: 150,
    minAmount: 20000,
    maxForwardAmount: 10000000,
    maxReverseAmount: 10000000,
    relays: ['wss://relay.example'],
    powBits: 30,
    createdAt: now,
    ...patch,
  }
}

describe('offer pow', () => {
  it('counts leading zero bits of the announcement hash', () => {
    expect(offerPowBits(fixture.offers[0].pubkey, fixture.offers[0].pow_nonce)).toBe(
      fixture.offers[0].pow_bits,
    )
    expect(offerPowBits(fixture.offers[1].pubkey, fixture.offers[1].pow_nonce)).toBe(
      fixture.offers[1].pow_bits,
    )
  })

  it('accepts a nonce without the hex prefix', () => {
    const row = fixture.offers[0]
    expect(offerPowBits(row.pubkey, row.pow_nonce.slice(2))).toBe(row.pow_bits)
  })

  it('maps the network tag', () => {
    expect(offerNetworkTag('mainnet')).toBe('net:mainnet')
    expect(offerNetworkTag('testnet')).toBe('net:testnet')
    expect(offerNetworkTag('signet')).toBe('net:signet')
    expect(offerNetworkTag('regtest')).toBe('net:regtest')
  })
})

describe('parseOffers', () => {
  it('parses the fixture announcements', () => {
    const offers = parseOffers(fixture.offers.map((row) => makeEvent(row)), parse)
    expect(offers).toHaveLength(2)
    const first = offers.find((offer) => offer.pubkey === fixture.offers[0].pubkey)
    expect(first?.feePercent).toBe(0.49)
    expect(first?.networkFee).toBe(150)
    expect(first?.minAmount).toBe(20000)
    expect(first?.maxForwardAmount).toBe(4500000)
    expect(first?.powBits).toBe(53)
    expect(first?.relays).toHaveLength(9)
    expect(first?.relays[0]).toBe('wss://relay.getalby.com/v1')
  })

  it('keeps only the first ten relays', () => {
    const many = Array.from({ length: 12 }, (_, i) => `wss://relay${i}.example`).join(',')
    const [offer] = parseOffers([makeEvent(fixture.offers[0], { content: contentOf(fixture.offers[0], { relays: many }) })], parse)
    expect(offer.relays).toHaveLength(10)
    expect(offer.relays[9]).toBe('wss://relay9.example')
  })

  it('sanitizes relays and skips non wss urls', () => {
    const row = fixture.offers[0]
    const relays = ' wss://a.example , wss://b.example, ,https://c.example, notaurl, wss://a.example '
    const [offer] = parseOffers([makeEvent(row, { content: contentOf(row, { relays }) })], parse)
    expect(offer.relays).toEqual(['wss://a.example', 'wss://b.example'])
  })

  it('skips an offer without any usable relay', () => {
    const row = fixture.offers[0]
    const offers = parseOffers(
      [makeEvent(row, { content: contentOf(row, { relays: 'http://a.example, junk' }) })],
      parse,
    )
    expect(offers[0].relays).toEqual([])
  })

  it('skips events with the wrong d tag', () => {
    expect(parseOffers([makeEvent(fixture.offers[0], { dTag: 'other' })], parse)).toEqual([])
  })

  it('skips events for another network', () => {
    expect(
      parseOffers([makeEvent(fixture.offers[0], { network: 'net:testnet' })], parse),
    ).toEqual([])
  })

  it('skips stale and far future events', () => {
    expect(
      parseOffers([makeEvent(fixture.offers[0], { created_at: now - 3601 })], parse),
    ).toEqual([])
    expect(
      parseOffers([makeEvent(fixture.offers[0], { created_at: now + 3601 })], parse),
    ).toEqual([])
  })

  it('skips a low pow announcement', () => {
    expect(parseOffers([makeEvent(fixture.offers[0])], { ...parse, powTarget: 54 })).toEqual([])
    expect(parseOffers([makeEvent(fixture.offers[0])], { ...parse, powTarget: 53 })).toHaveLength(1)
  })

  it('skips malformed content', () => {
    const row = fixture.offers[0]
    expect(parseOffers([makeEvent(row, { content: 'not json' })], parse)).toEqual([])
    expect(parseOffers([makeEvent(row, { content: '[1,2]' })], parse)).toEqual([])
    expect(parseOffers([makeEvent(row, { content: 'null' })], parse)).toEqual([])
  })

  it('skips a non-string relays field', () => {
    const row = fixture.offers[0]
    expect(
      parseOffers([makeEvent(row, { content: contentOf(row, { relays: 42 }) })], parse),
    ).toEqual([])
  })

  it.each([
    [5, 'out of range fee'],
    [-1, 'negative fee'],
    [0.5, 'valid fee'],
  ])('range checks percentage_fee %s', (value, _label) => {
    const row = fixture.offers[0]
    const offers = parseOffers([makeEvent(row, { content: contentOf(row, { percentage_fee: value }) })], parse)
    expect(offers).toHaveLength(value === 0.5 ? 1 : 0)
  })

  it.each([
    ['mining_fee', 0],
    ['mining_fee', -150],
    ['mining_fee', 150.5],
    ['min_amount', -1],
    ['max_forward_amount', -1],
    ['max_reverse_amount', -1],
  ])('skips an out-of-range %s = %s', (field, value) => {
    const row = fixture.offers[0]
    expect(parseOffers([makeEvent(row, { content: contentOf(row, { [field]: value }) })], parse)).toEqual([])
  })

  it('skips an offer whose minimum exceeds its forward maximum', () => {
    const row = fixture.offers[0]
    const offers = parseOffers(
      [makeEvent(row, { content: contentOf(row, { min_amount: 5000000, max_forward_amount: 4500000 }) })],
      parse,
    )
    expect(offers).toEqual([])
  })

  it('accepts min_amount equal to max_forward_amount', () => {
    const row = fixture.offers[0]
    const offers = parseOffers(
      [makeEvent(row, { content: contentOf(row, { min_amount: 4500000, max_forward_amount: 4500000 }) })],
      parse,
    )
    expect(offers).toHaveLength(1)
  })

  it.each([
    'percentage_fee',
    'mining_fee',
    'min_amount',
    'max_forward_amount',
    'max_reverse_amount',
  ])('skips a missing or non-numeric %s', (field) => {
    const row = fixture.offers[0]
    expect(parseOffers([makeEvent(row, { content: contentOf(row, { [field]: null }) })], parse)).toEqual([])
    expect(
      parseOffers([makeEvent(row, { content: contentOf(row, { [field]: '1' }) })], parse),
    ).toEqual([])
  })

  it('keeps only the latest announcement per pubkey', () => {
    const row = fixture.offers[0]
    const older = makeEvent(row, {
      created_at: now - 500,
      content: contentOf(row, { percentage_fee: 0.9 }),
    })
    const newer = makeEvent(row, {
      created_at: now - 100,
      content: contentOf(row, { percentage_fee: 0.4 }),
    })
    const offers = parseOffers([older, newer], parse)
    expect(offers).toHaveLength(1)
    expect(offers[0].feePercent).toBe(0.4)
  })

  it('keeps one offer per distinct pubkey', () => {
    const offers = parseOffers(fixture.offers.map((row) => makeEvent(row)), parse)
    expect(new Set(offers.map((offer) => offer.pubkey)).size).toBe(offers.length)
  })
})

describe('offerRange', () => {
  it('intersects the offer range with the app limits', () => {
    expect(offerRange(offerOf({ minAmount: 10000, maxForwardAmount: 5000000 }), appLimits)).toEqual({
      minAmount: 20000,
      maxAmount: 2000000,
    })
  })

  it('keeps a range when the offer is narrower than the app limits', () => {
    expect(offerRange(offerOf({ minAmount: 30000, maxForwardAmount: 100000 }), appLimits)).toEqual({
      minAmount: 30000,
      maxAmount: 100000,
    })
  })

  it('yields an empty range when the offer sits outside the app limits', () => {
    expect(offerRange(offerOf({ minAmount: 3000000 }), appLimits)).toEqual({
      minAmount: 3000000,
      maxAmount: 2000000,
    })
  })
})

describe('offerIdOf', () => {
  it('combines the pubkey and the announcement id', () => {
    expect(offerIdOf(offerOf({ pubkey: 'ab'.repeat(32), eventId: 'event-9' }))).toBe(
      `${'ab'.repeat(32)}:event-9`,
    )
  })
})

describe('selectPayoutOffers', () => {
  it('keeps an offer whose range covers the reference amount', () => {
    const offer = offerOf({ maxForwardAmount: 5000000, maxReverseAmount: 100 })
    expect(selectPayoutOffers([offer], appLimits, 2)).toEqual([offer])
  })

  it('keeps an offer whose minimum is above the reference amount', () => {
    const offer = offerOf({ minAmount: 100000 })
    expect(selectPayoutOffers([offer], appLimits, 2)).toEqual([offer])
  })

  it('drops an offer entirely below the app minimum', () => {
    const offer = offerOf({ minAmount: 1000, maxForwardAmount: 10000 })
    expect(selectPayoutOffers([offer], appLimits, 2)).toEqual([])
  })

  it('drops an offer entirely above the app maximum', () => {
    const offer = offerOf({ minAmount: 3000000, maxForwardAmount: 5000000 })
    expect(selectPayoutOffers([offer], appLimits, 2)).toEqual([])
  })

  it('drops an offer whose total cost is insane at the reference amount', () => {
    const offer = offerOf({ networkFee: 15000 })
    expect(selectPayoutOffers([offer], appLimits, 2)).toEqual([])
  })

  it('drops an offer whose upfront fee is insane at our fee rate', () => {
    const offer = offerOf({ networkFee: 1200 })
    expect(selectPayoutOffers([offer], appLimits, 2)).toEqual([])
    expect(selectPayoutOffers([offer], appLimits, 100)).toEqual([offer])
  })

  it('keeps the healthy fixture announcements', () => {
    const offers = parseOffers(fixture.offers.map((row) => makeEvent(row)), parse)
    expect(selectPayoutOffers(offers, appLimits, 2)).toHaveLength(2)
  })
})

describe('payout cost sanity', () => {
  it('exempts small costs', () => {
    expect(checkPayoutCosts({ sendAmount: 20000, onchainAmount: 15000 }).ok).toBe(true)
    expect(checkPayoutCosts({ sendAmount: 20000, onchainAmount: 5000 }).ok).toBe(false)
  })

  it('accepts a cost ratio up to 25 percent', () => {
    expect(checkPayoutCosts({ sendAmount: 1000000, onchainAmount: 750000 }).ok).toBe(true)
    expect(checkPayoutCosts({ sendAmount: 1000000, onchainAmount: 749000 }).ok).toBe(false)
  })

  it('rejects a large payout above 15 percent', () => {
    expect(checkPayoutCosts({ sendAmount: 10000000, onchainAmount: 8600000 }).ok).toBe(true)
    expect(checkPayoutCosts({ sendAmount: 10000000, onchainAmount: 8300000 }).ok).toBe(false)
  })
})

describe('upfront sanity', () => {
  it('caps the upfront at our own fee estimate', () => {
    expect(checkUpfront({ upfrontAmount: 1200, sendAmount: 100000, feeRateSatPerVb: 2 }).ok).toBe(true)
    expect(checkUpfront({ upfrontAmount: 1201, sendAmount: 100000, feeRateSatPerVb: 2 }).ok).toBe(false)
  })

  it('caps the upfront at half of the send amount', () => {
    expect(checkUpfront({ upfrontAmount: 50000, sendAmount: 100000, feeRateSatPerVb: 1000 }).ok).toBe(true)
    expect(checkUpfront({ upfrontAmount: 50001, sendAmount: 100000, feeRateSatPerVb: 1000 }).ok).toBe(false)
  })

  it('rejects an unusable fee rate', () => {
    expect(checkUpfront({ upfrontAmount: 1, sendAmount: 100000, feeRateSatPerVb: 0 }).ok).toBe(false)
  })
})
