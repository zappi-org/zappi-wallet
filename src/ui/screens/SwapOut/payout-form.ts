import { estimatePayout, type PayoutEstimate } from '@/core/domain/swap-out'
import {
  isBitcoinAddressShape,
  parseBitcoinPaymentInput,
  type BitcoinPaymentInput,
} from '@/core/domain/bitcoin-address'
import type { SwapOutOffer } from '@/core/ports/driving/swap-out.usecase'

export type PayoutAmountSide = 'send' | 'receive'

export type PayoutFormProblem =
  | { kind: 'min'; amount: number }
  | { kind: 'max'; amount: number }
  | { kind: 'address' }
  | { kind: 'balance' }

const LIGHTNING_RESERVE_PERCENT_DIVISOR = 100
const LIGHTNING_RESERVE_FLOOR = 4
const MAX_AMOUNT_DIGITS = 9

export function shortenIdentifier(value: string, head = 10, tail = 6): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function formatFeePercent(feePercent: number): string {
  return `${Number(feePercent.toFixed(3))}%`
}

export function lightningFeeReserve(sendAmount: number): number {
  return Math.ceil(sendAmount / LIGHTNING_RESERVE_PERCENT_DIVISOR) + LIGHTNING_RESERVE_FLOOR
}

export function maxSendableWithReserve(spendable: number): number {
  let amount = Math.max(
    0,
    Math.floor(
      ((spendable - LIGHTNING_RESERVE_FLOOR) * LIGHTNING_RESERVE_PERCENT_DIVISOR) /
        (LIGHTNING_RESERVE_PERCENT_DIVISOR + 1),
    ),
  )
  while (amount > 0 && amount + lightningFeeReserve(amount) > spendable) amount -= 1
  while (amount + 1 + lightningFeeReserve(amount + 1) <= spendable) amount += 1
  return amount
}

export function maxPayoutSendAmount(offer: SwapOutOffer, spendable: number): number {
  return Math.max(0, Math.min(offer.maxAmount, maxSendableWithReserve(spendable)))
}

export function sanitizeAmountText(raw: string): string {
  const digits = raw.replace(/\D/g, '').replace(/^0+/, '')
  return digits.slice(0, MAX_AMOUNT_DIGITS)
}

export function estimateFromSide(
  offer: SwapOutOffer,
  side: PayoutAmountSide,
  amount: number,
  destination: string,
): PayoutEstimate | null {
  if (!Number.isSafeInteger(amount) || amount <= 0) return null
  const base = {
    feePercent: offer.feePercent,
    networkFee: offer.networkFee,
    payoutFeeRate: offer.payoutFeeRate,
    destination,
  }
  try {
    return side === 'send'
      ? estimatePayout({ ...base, sendAmount: amount })
      : estimatePayout({ ...base, receiveAmount: amount })
  } catch {
    return null
  }
}

export function isValidPayoutAddress(address: string): boolean {
  return isBitcoinAddressShape(address)
}

export function payoutFormProblem(params: {
  offer: SwapOutOffer
  sendAmount: number
  address: string
  spendable: number
}): PayoutFormProblem | null {
  const { offer, sendAmount, address, spendable } = params
  if (sendAmount > 0 && sendAmount < offer.minAmount) return { kind: 'min', amount: offer.minAmount }
  if (sendAmount > offer.maxAmount) return { kind: 'max', amount: offer.maxAmount }
  if (address.trim().length > 0 && !isValidPayoutAddress(address)) return { kind: 'address' }
  if (sendAmount > 0 && sendAmount + lightningFeeReserve(sendAmount) > spendable) {
    return { kind: 'balance' }
  }
  return null
}

export interface PayoutFormValues {
  amountText: string
  amountSide: PayoutAmountSide
  address: string
}

export function derivePayoutAmounts(
  offer: SwapOutOffer,
  values: PayoutFormValues,
): { sendAmount: number; receiveAmount: number; estimate: PayoutEstimate | null } {
  const typed = Number(values.amountText || '0')
  const estimate = estimateFromSide(offer, values.amountSide, typed, values.address.trim())
  if (values.amountSide === 'send') {
    return { sendAmount: typed, receiveAmount: estimate ? Math.max(0, estimate.receiveAmount) : 0, estimate }
  }
  return { sendAmount: estimate ? estimate.sendAmount : 0, receiveAmount: typed, estimate }
}

export function parsePayoutAddressInput(raw: string): BitcoinPaymentInput | null {
  const direct = parseBitcoinPaymentInput(raw)
  if (direct) return direct
  const trimmed = raw.trim()
  const queryIndex = trimmed.indexOf('?')
  if (!/^bitcoin:/i.test(trimmed) || queryIndex === -1) return null
  const params = new URLSearchParams(trimmed.slice(queryIndex + 1))
  if (!params.has('lightning')) return null
  params.delete('lightning')
  const rest = params.toString()
  const base = trimmed.slice(0, queryIndex)
  return parseBitcoinPaymentInput(rest ? `${base}?${rest}` : base)
}
