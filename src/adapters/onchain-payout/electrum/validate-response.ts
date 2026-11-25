import { decode } from 'light-bolt11-decoder'
import { hexToBytes } from '@noble/hashes/utils.js'
import { Err, Ok, type Result } from '@/core/domain/result'
import { checkPayoutCosts, checkUpfront } from './offers'
import { verifyServerPayoutScript } from './payout-script'
import type { PayoutNetwork } from './network'

const MAX_MIN_FINAL_CLTV_DELTA = 435
const DEFAULT_MIN_FINAL_CLTV_DELTA = 18
const DEFAULT_EXPIRY_SECONDS = 3600
const NETWORK_PREFIXES: Record<PayoutNetwork, string> = {
  mainnet: 'bc',
  testnet: 'tb',
  signet: 'tbs',
  regtest: 'bcrt',
}

interface DecodedRequest {
  networkPrefix: string
  paymentHash: string
  amount: number
  minFinalCltv: number
  expiresAt: number
}

interface DecodedSection {
  name: string
  letters?: string
  value?: unknown
}

export interface PayoutResponseData {
  id: string
  invoice: string
  minerFeeInvoice?: string
  lockupAddress: string
  redeemScript: string
  timeoutBlockHeight: number
  onchainAmount: number
}

export interface ValidatePayoutResponseParams {
  paymentHash: string
  claimPubkey: string
  invoiceAmount: number
  expectedOnchainAmount: number
  maxUpfrontAmount: number
  feeRateSatPerVb: number
  currentHeight: number
  now: number
  network: PayoutNetwork
}

export interface ValidatedPayoutRequest {
  request: string
  amount: number
}

export interface ValidatedPayout {
  serverId: string
  mainRequest: ValidatedPayoutRequest
  upfrontRequest?: ValidatedPayoutRequest
  lockupAddress: string
  redeemScriptHex: string
  locktime: number
  onchainAmount: number
  refundPubkey: string
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function readResponse(data: unknown): PayoutResponseData | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const body = data as Record<string, unknown>
  const { id, invoice, minerFeeInvoice, lockupAddress, redeemScript } = body
  if (typeof id !== 'string' || typeof invoice !== 'string') return null
  if (minerFeeInvoice !== undefined && typeof minerFeeInvoice !== 'string') return null
  if (typeof lockupAddress !== 'string' || typeof redeemScript !== 'string') return null
  if (!isInteger(body.timeoutBlockHeight) || !isInteger(body.onchainAmount)) return null
  return {
    id,
    invoice,
    minerFeeInvoice,
    lockupAddress,
    redeemScript,
    timeoutBlockHeight: body.timeoutBlockHeight,
    onchainAmount: body.onchainAmount,
  }
}

function decodeRequest(request: string): DecodedRequest | null {
  let sections: DecodedSection[]
  try {
    sections = decode(request).sections as DecodedSection[]
  } catch {
    return null
  }
  const find = (name: string) => sections.find((section) => section.name === name)
  const network = find('coin_network')
  const paymentHash = find('payment_hash')
  const amount = find('amount')
  const timestamp = find('timestamp')
  const expiry = find('expiry')
  const cltv = find('min_final_cltv_expiry')
  if (typeof network?.letters !== 'string') return null
  if (typeof paymentHash?.value !== 'string') return null
  if (typeof amount?.value !== 'string') return null
  const amountMsat = Number(amount.value)
  if (!Number.isSafeInteger(amountMsat) || amountMsat <= 0) return null
  if (amountMsat % 1000 !== 0) return null
  if (typeof timestamp?.value !== 'number') return null
  const expirySeconds =
    typeof expiry?.value === 'number' ? expiry.value : DEFAULT_EXPIRY_SECONDS
  const minFinalCltv =
    typeof cltv?.value === 'number' ? cltv.value : DEFAULT_MIN_FINAL_CLTV_DELTA
  return {
    networkPrefix: network.letters,
    paymentHash: paymentHash.value,
    amount: amountMsat / 1000,
    minFinalCltv,
    expiresAt: timestamp.value + expirySeconds,
  }
}

export function validatePayoutResponse(
  data: unknown,
  params: ValidatePayoutResponseParams,
): Result<ValidatedPayout, string> {
  const response = readResponse(data)
  if (!response) return Err('payout response is malformed')

  const expectedPrefix = NETWORK_PREFIXES[params.network]
  const main = decodeRequest(response.invoice)
  if (!main) return Err('payout invoice cannot be decoded')
  if (main.networkPrefix !== expectedPrefix) return Err('payout invoice network is wrong')
  if (main.paymentHash !== params.paymentHash) return Err('payout invoice hash is wrong')
  if (main.minFinalCltv > MAX_MIN_FINAL_CLTV_DELTA) return Err('payout invoice cltv is too large')
  if (main.expiresAt < params.now) return Err('payout invoice has expired')

  let upfrontAmount = 0
  if (response.minerFeeInvoice) {
    const upfront = decodeRequest(response.minerFeeInvoice)
    if (!upfront) return Err('upfront invoice cannot be decoded')
    if (upfront.networkPrefix !== expectedPrefix) return Err('upfront invoice network is wrong')
    if (upfront.minFinalCltv > MAX_MIN_FINAL_CLTV_DELTA) {
      return Err('upfront invoice cltv is too large')
    }
    if (upfront.expiresAt < params.now) return Err('upfront invoice has expired')
    if (upfront.amount > params.maxUpfrontAmount) return Err('upfront invoice is too large')
    upfrontAmount = upfront.amount
  }

  if (main.amount + upfrontAmount !== params.invoiceAmount) {
    return Err('payout invoice amounts do not match the request')
  }
  if (response.onchainAmount < params.expectedOnchainAmount) {
    return Err('payout onchain amount is too low')
  }
  const costCheck = checkPayoutCosts({
    sendAmount: params.invoiceAmount,
    onchainAmount: response.onchainAmount,
  })
  if (!costCheck.ok) return Err(costCheck.error)
  const upfrontCheck = checkUpfront({
    upfrontAmount,
    sendAmount: params.invoiceAmount,
    feeRateSatPerVb: params.feeRateSatPerVb,
  })
  if (!upfrontCheck.ok) return Err(upfrontCheck.error)

  if (!/^[0-9a-fA-F]*$/.test(response.redeemScript) || response.redeemScript.length % 2 !== 0) {
    return Err('payout script is not hex')
  }
  const scriptResult = verifyServerPayoutScript({
    script: hexToBytes(response.redeemScript),
    expectedPaymentHash: hexToBytes(params.paymentHash),
    expectedClaimPubkey: hexToBytes(params.claimPubkey),
    expectedLocktime: response.timeoutBlockHeight,
    expectedAddress: response.lockupAddress,
    currentHeight: params.currentHeight,
    network: params.network,
  })
  if (!scriptResult.ok) return Err(scriptResult.error)

  const validated: ValidatedPayout = {
    serverId: response.id,
    mainRequest: { request: response.invoice, amount: main.amount },
    lockupAddress: response.lockupAddress,
    redeemScriptHex: response.redeemScript.toLowerCase(),
    locktime: response.timeoutBlockHeight,
    onchainAmount: response.onchainAmount,
    refundPubkey: scriptResult.value.refundPubkey,
  }
  if (response.minerFeeInvoice) {
    validated.upfrontRequest = {
      request: response.minerFeeInvoice,
      amount: upfrontAmount,
    }
  }
  return Ok(validated)
}
