import { describe, expect, it } from 'vitest'
import type { SwapOutOffer } from '@/core/ports/driving/swap-out.usecase'
import {
  derivePayoutAmounts,
  formatFeePercent,
  lightningFeeReserve,
  maxPayoutSendAmount,
  maxSendableWithReserve,
  parsePayoutAddressInput,
  payoutFormProblem,
  sanitizeAmountText,
  shortenIdentifier,
} from '@/ui/screens/SwapOut/payout-form'

const ADDRESS = 'bcrt1qw508d6qejxtdg4y5r3zarvary0c5xw7kygt080'

const OFFER: SwapOutOffer = {
  offerId: 'offer-1',
  identifier: 'npub1provider',
  feePercent: 0.25,
  networkFee: 400,
  payoutFeeRate: 3,
  payoutFeeEstimate: 408,
  minAmount: 25000,
  maxAmount: 2000000,
  seenAt: 1,
}

describe('payout form helpers', () => {
  it('keeps the largest amount that still fits with the lightning reserve', () => {
    for (const spendable of [0, 3, 10, 101, 5000, 123456, 500000]) {
      const max = maxSendableWithReserve(spendable)
      if (max > 0) expect(max + lightningFeeReserve(max)).toBeLessThanOrEqual(spendable)
      expect(max + 1 + lightningFeeReserve(max + 1)).toBeGreaterThan(spendable)
    }
  })

  it('caps Max at the provider maximum', () => {
    expect(maxPayoutSendAmount(OFFER, 50_000_000)).toBe(OFFER.maxAmount)
    expect(maxPayoutSendAmount(OFFER, 100_000)).toBe(maxSendableWithReserve(100_000))
  })

  it('reports problems in order: minimum, maximum, address, balance', () => {
    const check = (sendAmount: number, address: string, spendable = 1_000_000) =>
      payoutFormProblem({ offer: OFFER, sendAmount, address, spendable })?.kind ?? null
    expect(check(1000, 'nope', 0)).toBe('min')
    expect(check(3_000_000, 'nope', 0)).toBe('max')
    expect(check(100_000, 'nope', 0)).toBe('address')
    expect(check(100_000, ADDRESS, 100_000)).toBe('balance')
    expect(check(100_000, ADDRESS)).toBeNull()
    expect(check(0, '')).toBeNull()
  })

  it('derives the other side from the last edited amount', () => {
    const fromSend = derivePayoutAmounts(OFFER, { amountSide: 'send', amountText: '100000', address: ADDRESS })
    expect(fromSend.sendAmount).toBe(100000)
    const back = derivePayoutAmounts(OFFER, {
      amountSide: 'receive',
      amountText: String(fromSend.receiveAmount),
      address: ADDRESS,
    })
    expect(back.receiveAmount).toBe(fromSend.receiveAmount)
    expect(back.sendAmount).toBeLessThanOrEqual(100000)
    const tiny = derivePayoutAmounts(OFFER, { amountSide: 'send', amountText: '10', address: ADDRESS })
    expect(tiny.receiveAmount).toBe(0)
    const empty = derivePayoutAmounts(OFFER, { amountSide: 'send', amountText: '', address: ADDRESS })
    expect(empty.estimate).toBeNull()
  })

  it('formats identifiers, fee rates and typed amounts', () => {
    expect(shortenIdentifier('npub1abcdefghijklmnopqrstuvwxyz')).toBe('npub1abcde…uvwxyz')
    expect(shortenIdentifier('short')).toBe('short')
    expect(formatFeePercent(0.1)).toBe('0.1%')
    expect(formatFeePercent(0.12345)).toBe('0.123%')
    expect(sanitizeAmountText('0012a3')).toBe('123')
    expect(sanitizeAmountText('12345678901')).toBe('123456789')
  })

  it('reads the on-chain part of a unified payment URI', () => {
    expect(parsePayoutAddressInput(`bitcoin:${ADDRESS}?amount=0.001&lightning=lnbcrt1pexample`)).toEqual({
      address: ADDRESS,
      amountSats: 100000,
    })
    expect(parsePayoutAddressInput(`BITCOIN:${ADDRESS}?lightning=lnbcrt1pexample`)).toEqual({ address: ADDRESS })
    expect(parsePayoutAddressInput(`bitcoin:${ADDRESS}?amount=0.002`)).toEqual({ address: ADDRESS, amountSats: 200000 })
    expect(parsePayoutAddressInput('bitcoin:nope?lightning=lnbcrt1pexample')).toBeNull()
    expect(parsePayoutAddressInput('hello')).toBeNull()
  })
})
