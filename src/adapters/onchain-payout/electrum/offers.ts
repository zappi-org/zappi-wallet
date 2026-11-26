import { sha256 } from '@noble/hashes/sha2.js'
import { hexToBytes } from '@noble/hashes/utils.js'
import { payoutReceiveAmount } from '@/core/domain/onchain-payout'
import { Err, Ok, type Result } from '@/core/domain/result'
import type { PayoutRelayClient, PayoutRelayEvent } from './relay-client'
import type { PayoutNetwork } from './network'

export const OFFER_KIND = 30315
export const OFFER_D_TAG = 'electrum-swapserver-5'
export const POW_TARGET_BITS = 30
export const REQUEST_KIND = 25582

export const SWAP_TX_SIZE = 150
export const MAX_PREPAY_RATIO = 0.5
export const MAX_PREPAY_FEE_MULTIPLIER = 4
export const REFERENCE_PAYOUT_SATS = 20_000

const OFFER_MAX_AGE_SECONDS = 3600
const MAX_OFFER_RELAYS = 10
const NONCE_BYTES = 32
const PUBKEY_BYTES = 32
const MAX_PERCENTAGE_FEE = 5
const SMALL_PAYOUT_SATS = 10_000
const COST_RATIO_LIMIT = 0.25
const LARGE_COST_SATS = 1_000_000
const LARGE_COST_RATIO_LIMIT = 0.15

export interface PayoutOffer {
  eventId: string
  pubkey: string
  feePercent: number
  networkFee: number
  minAmount: number
  maxForwardAmount: number
  maxReverseAmount: number
  relays: string[]
  powBits: number
  createdAt: number
}

export interface ParseOffersParams {
  network: PayoutNetwork
  now: number
  powTarget: number
}

export interface AppPayoutLimits {
  appMinAmount: number
  appMaxAmount: number
}

export function offerNetworkTag(network: PayoutNetwork): string {
  return `net:${network}`
}

export function offerPowBits(pubkeyHex: string, nonceHex: string): number {
  const nonce = BigInt(nonceHex.startsWith('0x') ? nonceHex : `0x${nonceHex}`)
  const nonceBytes = new Uint8Array(NONCE_BYTES)
  let remaining = nonce
  for (let i = NONCE_BYTES - 1; i >= 0 && remaining > 0n; i--) {
    nonceBytes[i] = Number(remaining & 0xffn)
    remaining >>= 8n
  }
  const prefix = new TextEncoder().encode('electrum-')
  const payload = new Uint8Array(prefix.length + PUBKEY_BYTES + NONCE_BYTES)
  payload.set(prefix)
  payload.set(hexToBytes(pubkeyHex), prefix.length)
  payload.set(nonceBytes, prefix.length + PUBKEY_BYTES)
  const digest = sha256(payload)
  let bits = 0
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8
      continue
    }
    bits += Math.clz32(byte) - 24
    break
  }
  return bits
}

export interface PayoutCostParams {
  sendAmount: number
  onchainAmount: number
}

export interface PayoutUpfrontParams {
  upfrontAmount: number
  sendAmount: number
  feeRateSatPerVb: number
}

export function checkPayoutCosts(params: PayoutCostParams): Result<void, string> {
  const { sendAmount, onchainAmount } = params
  if (sendAmount <= 0) return Err('payout send amount is not positive')
  const cost = sendAmount - onchainAmount
  if (cost < SMALL_PAYOUT_SATS) return Ok(undefined)
  const ratio = cost / sendAmount
  if (ratio > COST_RATIO_LIMIT) return Err('payout cost is too high')
  if (cost > LARGE_COST_SATS && ratio > LARGE_COST_RATIO_LIMIT) {
    return Err('payout cost is too high')
  }
  return Ok(undefined)
}

export function checkUpfront(params: PayoutUpfrontParams): Result<void, string> {
  const { upfrontAmount, sendAmount, feeRateSatPerVb } = params
  if (!Number.isFinite(feeRateSatPerVb) || feeRateSatPerVb <= 0) {
    return Err('payout fee rate is not usable')
  }
  const ours = MAX_PREPAY_FEE_MULTIPLIER * Math.ceil(SWAP_TX_SIZE * feeRateSatPerVb)
  const maxUpfront = Math.min(Math.floor(MAX_PREPAY_RATIO * sendAmount), ours)
  if (upfrontAmount > maxUpfront) return Err('payout upfront amount is too high')
  return Ok(undefined)
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : null
}

function readFeePercent(value: unknown): number | null {
  const percent = readNumber(value)
  if (percent === null || percent < 0 || percent >= MAX_PERCENTAGE_FEE) return null
  return percent
}

function readRelays(value: unknown): string[] | null {
  if (typeof value !== 'string') return null
  const relays: string[] = []
  for (const candidate of value.split(',')) {
    const trimmed = candidate.trim()
    if (!trimmed.startsWith('wss://')) continue
    try {
      new URL(trimmed)
    } catch {
      continue
    }
    if (!relays.includes(trimmed)) relays.push(trimmed)
    if (relays.length === MAX_OFFER_RELAYS) break
  }
  return relays
}

function tagsOf(event: PayoutRelayEvent): Map<string, string> {
  const tags = new Map<string, string>()
  for (const tag of event.tags) {
    if (tag.length >= 2 && !tags.has(tag[0])) tags.set(tag[0], tag[1])
  }
  return tags
}

function latestPerPubkey(events: PayoutRelayEvent[]): PayoutRelayEvent[] {
  const latest = new Map<string, PayoutRelayEvent>()
  for (const event of events) {
    const current = latest.get(event.pubkey)
    if (!current || event.created_at > current.created_at) latest.set(event.pubkey, event)
  }
  return [...latest.values()]
}

export function parseOffers(
  events: PayoutRelayEvent[],
  params: ParseOffersParams,
): PayoutOffer[] {
  const { network, now, powTarget } = params
  const expectedNetwork = offerNetworkTag(network)
  const fresh = events.filter((event) => {
    const tags = tagsOf(event)
    if (tags.get('d') !== OFFER_D_TAG) return false
    if (tags.get('r') !== expectedNetwork) return false
    if (event.created_at > now + OFFER_MAX_AGE_SECONDS) return false
    if (event.created_at < now - OFFER_MAX_AGE_SECONDS) return false
    return true
  })

  const offers: PayoutOffer[] = []
  for (const event of latestPerPubkey(fresh)) {
    let content: unknown
    try {
      content = JSON.parse(event.content)
    } catch {
      continue
    }
    if (typeof content !== 'object' || content === null || Array.isArray(content)) continue
    const body = content as Record<string, unknown>

    let powBits: number
    try {
      const nonce = typeof body.pow_nonce === 'string' ? body.pow_nonce : '0'
      powBits = offerPowBits(event.pubkey, nonce)
    } catch {
      continue
    }
    if (powBits < powTarget) continue

    const relays = readRelays(body.relays)
    if (relays === null) continue

    const feePercent = readFeePercent(body.percentage_fee)
    const networkFee = readInteger(body.mining_fee)
    const minAmount = readInteger(body.min_amount)
    const maxForwardAmount = readInteger(body.max_forward_amount)
    const maxReverseAmount = readInteger(body.max_reverse_amount)
    if (
      feePercent === null ||
      networkFee === null ||
      networkFee <= 0 ||
      minAmount === null ||
      minAmount < 0 ||
      maxForwardAmount === null ||
      maxForwardAmount < 0 ||
      maxReverseAmount === null ||
      maxReverseAmount < 0 ||
      minAmount > maxForwardAmount
    ) {
      continue
    }

    offers.push({
      eventId: event.id,
      pubkey: event.pubkey,
      feePercent,
      networkFee,
      minAmount,
      maxForwardAmount,
      maxReverseAmount,
      relays,
      powBits,
      createdAt: event.created_at,
    })
  }
  return offers
}

export function offerRange(
  offer: PayoutOffer,
  limits: AppPayoutLimits,
): { minAmount: number; maxAmount: number } {
  return {
    minAmount: Math.max(offer.minAmount, limits.appMinAmount),
    maxAmount: Math.min(offer.maxForwardAmount, limits.appMaxAmount),
  }
}

export function offerIdOf(offer: PayoutOffer): string {
  return `${offer.pubkey}:${offer.eventId}`
}

export function selectPayoutOffers(
  offers: PayoutOffer[],
  limits: AppPayoutLimits,
  feeRateSatPerVb: number,
): PayoutOffer[] {
  return offers.filter((offer) => {
    const { minAmount, maxAmount } = offerRange(offer, limits)
    if (minAmount > maxAmount) return false
    const reference = Math.min(maxAmount, Math.max(minAmount, REFERENCE_PAYOUT_SATS))
    const onchainAmount = payoutReceiveAmount({
      sendAmount: reference,
      feePercent: offer.feePercent,
      networkFee: offer.networkFee,
    })
    if (!checkPayoutCosts({ sendAmount: reference, onchainAmount }).ok) return false
    return checkUpfront({
      upfrontAmount: 2 * offer.networkFee,
      sendAmount: reference,
      feeRateSatPerVb,
    }).ok
  })
}

export async function fetchOffers(
  client: PayoutRelayClient,
  params: {
    network: PayoutNetwork
    relays: string[]
    now: number
    maxWaitMs: number
    powTarget?: number
  },
): Promise<PayoutOffer[]> {
  const { network, relays, now, maxWaitMs } = params
  const events = await client.query(
    relays,
    {
      kinds: [OFFER_KIND],
      '#d': [OFFER_D_TAG],
      '#r': [offerNetworkTag(network)],
      since: now - OFFER_MAX_AGE_SECONDS,
    },
    maxWaitMs,
  )
  return parseOffers(events, {
    network,
    now,
    powTarget: params.powTarget ?? POW_TARGET_BITS,
  })
}
