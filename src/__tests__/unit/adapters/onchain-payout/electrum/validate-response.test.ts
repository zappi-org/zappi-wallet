import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decode } from 'light-bolt11-decoder'
import { pubECDSA } from '@scure/btc-signer/utils.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import {
  validatePayoutResponse,
  type ValidatePayoutResponseParams,
} from '@/adapters/onchain-payout/electrum/validate-response'

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

const fixture: { cases: CreateswapCase[] } = JSON.parse(
  readFileSync('src/__tests__/fixtures/onchain-payout/createswap.json', 'utf8'),
)

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]

function polymod(values: number[]): number {
  let checksum = 1
  for (const value of values) {
    const top = checksum >> 25
    checksum = ((checksum & 0x1ffffff) << 5) ^ value
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) checksum ^= GENERATOR[i]
    }
  }
  return checksum
}

function expandHrp(hrp: string): number[] {
  const out: number[] = []
  for (const char of hrp) out.push(char.charCodeAt(0) >> 5)
  out.push(0)
  for (const char of hrp) out.push(char.charCodeAt(0) & 31)
  return out
}

function toWords(value: number, length: number): number[] {
  const words = new Array<number>(length).fill(0)
  let remaining = value
  for (let i = length - 1; i >= 0; i--) {
    words[i] = remaining & 31
    remaining = Math.floor(remaining / 32)
  }
  return words
}

function bytesToWords(bytes: Uint8Array): number[] {
  const words: number[] = []
  let accumulator = 0
  let bits = 0
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      words.push((accumulator >> bits) & 31)
    }
  }
  if (bits > 0) words.push((accumulator << (5 - bits)) & 31)
  return words
}

function encodeBech32(hrp: string, data: number[]): string {
  const values = [...expandHrp(hrp), ...data, 0, 0, 0, 0, 0, 0]
  const mod = polymod(values) ^ 1
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >> (5 * (5 - i))) & 31)
  return `${hrp}1${[...data, ...checksum].map((word) => CHARSET[word]).join('')}`
}

function tagged(code: number, words: number[]): number[] {
  return [code, ...toWords(words.length, 2), ...words]
}

function encodeInvoice(params: {
  prefix: string
  amountSat: number
  paymentHash: string
  timestamp: number
  expiry?: number
  cltv?: number
}): string {
  const hrp = `ln${params.prefix}${params.amountSat * 10}n`
  const data = [
    ...toWords(params.timestamp, 7),
    ...tagged(1, bytesToWords(hexToBytes(params.paymentHash))),
    ...(params.expiry === undefined ? [] : tagged(6, toWords(params.expiry, 2))),
    ...(params.cltv === undefined ? [] : tagged(24, toWords(params.cltv, 2))),
    ...new Array<number>(104).fill(0),
  ]
  return encodeBech32(hrp, data)
}

const baseCase = fixture.cases[0]
const preimage = hexToBytes(baseCase.seed.preimage)
const paymentHash = bytesToHex(sha256(preimage))
const claimPubkey = bytesToHex(pubECDSA(hexToBytes(baseCase.seed.claimPrivateKey)))

function invoiceTimestamp(invoice: string): number {
  const sections = decode(invoice).sections as { name: string; value?: unknown }[]
  const timestamp = sections.find((section) => section.name === 'timestamp')?.value
  return typeof timestamp === 'number' ? timestamp : 0
}

const now = invoiceTimestamp(baseCase.invoice) + 10
const currentHeight = baseCase.timeoutBlockHeight - 80

function response(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: baseCase.id,
    invoice: baseCase.invoice,
    minerFeeInvoice: baseCase.minerFeeInvoice,
    lockupAddress: baseCase.lockupAddress,
    redeemScript: baseCase.redeemScript,
    timeoutBlockHeight: baseCase.timeoutBlockHeight,
    onchainAmount: baseCase.onchainAmount,
    ...patch,
  }
}

function params(patch: Partial<ValidatePayoutResponseParams> = {}): ValidatePayoutResponseParams {
  return {
    paymentHash,
    claimPubkey,
    invoiceAmount: baseCase.seed.invoiceAmount,
    expectedOnchainAmount: baseCase.onchainAmount,
    maxUpfrontAmount: baseCase.seed.invoiceAmount,
    feeRateSatPerVb: 75,
    currentHeight,
    now,
    network: 'regtest',
    ...patch,
  }
}

function craftedInvoices(options: {
  prefix?: string
  mainAmount?: number
  upfrontAmount?: number | null
  cltv?: number
  expiry?: number
  hash?: string
} = {}): { invoice: string; minerFeeInvoice?: string } {
  const prefix = options.prefix ?? 'bcrt'
  const mainAmount = options.mainAmount ?? 55000
  const upfrontAmount = options.upfrontAmount === undefined ? 45000 : options.upfrontAmount
  const invoice = encodeInvoice({
    prefix,
    amountSat: mainAmount,
    paymentHash: options.hash ?? paymentHash,
    timestamp: invoiceTimestamp(baseCase.invoice),
    expiry: options.expiry,
    cltv: options.cltv,
  })
  if (upfrontAmount === null) return { invoice }
  const minerFeeInvoice = encodeInvoice({
    prefix,
    amountSat: upfrontAmount,
    paymentHash: options.hash ?? paymentHash,
    timestamp: invoiceTimestamp(baseCase.invoice),
    expiry: options.expiry,
    cltv: options.cltv,
  })
  return { invoice, minerFeeInvoice }
}

describe('validatePayoutResponse', () => {
  it('accepts a real regtest createswap response', () => {
    const result = validatePayoutResponse(response(), params())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.serverId).toBe(baseCase.id)
    expect(result.value.mainRequest.amount).toBe(55000)
    expect(result.value.upfrontRequest?.amount).toBe(45000)
    expect(result.value.lockupAddress).toBe(baseCase.lockupAddress)
    expect(result.value.redeemScriptHex).toBe(baseCase.redeemScript)
    expect(result.value.locktime).toBe(baseCase.timeoutBlockHeight)
    expect(result.value.onchainAmount).toBe(baseCase.onchainAmount)
    expect(result.value.refundPubkey).toHaveLength(66)
  })

  it('accepts a second real regtest response', () => {
    const second = fixture.cases[1]
    const result = validatePayoutResponse(
      {
        id: second.id,
        invoice: second.invoice,
        minerFeeInvoice: second.minerFeeInvoice,
        lockupAddress: second.lockupAddress,
        redeemScript: second.redeemScript,
        timeoutBlockHeight: second.timeoutBlockHeight,
        onchainAmount: second.onchainAmount,
      },
      params({
        paymentHash: bytesToHex(sha256(hexToBytes(second.seed.preimage))),
        claimPubkey: bytesToHex(pubECDSA(hexToBytes(second.seed.claimPrivateKey))),
        invoiceAmount: second.seed.invoiceAmount,
        expectedOnchainAmount: second.onchainAmount,
        currentHeight: second.timeoutBlockHeight - 70,
        now: invoiceTimestamp(second.invoice) + 10,
      }),
    )
    expect(result.ok).toBe(true)
  })

  it('rejects a malformed response body', () => {
    expect(validatePayoutResponse('nope', params()).ok).toBe(false)
    expect(validatePayoutResponse(null, params()).ok).toBe(false)
    expect(validatePayoutResponse(response({ invoice: 42 }), params()).ok).toBe(false)
    expect(validatePayoutResponse(response({ timeoutBlockHeight: 1.5 }), params()).ok).toBe(false)
  })

  it('rejects an invoice with another payment hash', () => {
    const crafted = craftedInvoices({ hash: 'cc'.repeat(32) })
    expect(validatePayoutResponse(response(crafted), params()).ok).toBe(false)
  })

  it('rejects an invoice cltv above the limit', () => {
    const crafted = craftedInvoices({ cltv: 436 })
    expect(validatePayoutResponse(response(crafted), params()).ok).toBe(false)
  })

  it('accepts an invoice cltv at the limit', () => {
    const crafted = craftedInvoices({ cltv: 435 })
    const result = validatePayoutResponse(response(crafted), params())
    expect(result.ok).toBe(true)
  })

  it('rejects an amount mismatch', () => {
    const crafted = craftedInvoices({ mainAmount: 54000 })
    expect(validatePayoutResponse(response(crafted), params()).ok).toBe(false)
  })

  it('rejects an upfront invoice above the cap', () => {
    expect(validatePayoutResponse(response(), params({ maxUpfrontAmount: 44000 })).ok).toBe(false)
  })

  it('rejects an upfront invoice above our own fee estimate', () => {
    expect(validatePayoutResponse(response(), params({ feeRateSatPerVb: 74 })).ok).toBe(false)
  })

  it('rejects an insane total cost', () => {
    const patched = params({ expectedOnchainAmount: 50000 })
    expect(validatePayoutResponse(response({ onchainAmount: 50000 }), patched).ok).toBe(false)
  })

  it('rejects a too low onchain amount', () => {
    const patched = params({ expectedOnchainAmount: baseCase.onchainAmount + 1 })
    expect(validatePayoutResponse(response(), patched).ok).toBe(false)
  })

  it('rejects a script that does not match', () => {
    const other = fixture.cases[1]
    expect(validatePayoutResponse(response({ redeemScript: other.redeemScript }), params()).ok).toBe(
      false,
    )
  })

  it('rejects a non hex script', () => {
    expect(validatePayoutResponse(response({ redeemScript: 'zz' }), params()).ok).toBe(false)
  })

  it('rejects a locktime too close to the tip', () => {
    expect(
      validatePayoutResponse(response(), params({ currentHeight: baseCase.timeoutBlockHeight - 60 })).ok,
    ).toBe(false)
  })

  it('rejects an invoice from another network', () => {
    const crafted = craftedInvoices({ prefix: 'bc' })
    expect(validatePayoutResponse(response(crafted), params()).ok).toBe(false)
  })

  it('rejects an expired invoice', () => {
    const patched = params({ now: invoiceTimestamp(baseCase.invoice) + 3600 })
    expect(validatePayoutResponse(response(), patched).ok).toBe(false)
  })

  it('accepts a response without an upfront invoice when the amount matches', () => {
    const crafted = craftedInvoices({ mainAmount: baseCase.seed.invoiceAmount, upfrontAmount: null })
    const result = validatePayoutResponse(response({ ...crafted, minerFeeInvoice: undefined }), params())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.upfrontRequest).toBeUndefined()
    expect(result.value.mainRequest.amount).toBe(baseCase.seed.invoiceAmount)
  })
})
