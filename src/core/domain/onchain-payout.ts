import { isBitcoinAddressShape } from './bitcoin-address'
import {
  transitionPhase,
  type PendingTransfer,
  type TransferPhase,
} from './pending-transfer'
import { Err, Ok, type Result } from './result'

export const PAYOUT_SWEEP_VSIZE = 136

const PAYOUT_SWEEP_BASE_VSIZE = 105
const PAYOUT_SWEEP_VALUE_BYTES = 8
const PAYOUT_LARGEST_SWEEP_SCRIPT_LENGTH = 34
const PAYOUT_KEY_HASH_SCRIPT_LENGTH = 25
const PAYOUT_SCRIPT_HASH_SCRIPT_LENGTH = 23
const PAYOUT_WITNESS_KEY_SCRIPT_LENGTH = 22

const WITNESS_ADDRESS = /^(bc|tb|bcrt)1/

function varIntLength(value: number): number {
  if (value < 0xfd) return 1
  return value <= 0xffff ? 3 : 5
}

export function payoutSweepVsizeForScriptLength(scriptLength: number): number {
  assertNonNegativeInteger('scriptLength', scriptLength)
  return (
    PAYOUT_SWEEP_BASE_VSIZE +
    PAYOUT_SWEEP_VALUE_BYTES +
    varIntLength(scriptLength) +
    scriptLength
  )
}

function payoutSweepScriptLength(destination: string): number {
  const address = destination.trim()
  if (!isBitcoinAddressShape(address)) return PAYOUT_LARGEST_SWEEP_SCRIPT_LENGTH
  const lower = address.toLowerCase()
  if (WITNESS_ADDRESS.test(lower)) {
    const data = lower.slice(lower.indexOf('1') + 1)
    return data.startsWith('q') && data.length === 39
      ? PAYOUT_WITNESS_KEY_SCRIPT_LENGTH
      : PAYOUT_LARGEST_SWEEP_SCRIPT_LENGTH
  }
  return /^[1mn]/.test(address)
    ? PAYOUT_KEY_HASH_SCRIPT_LENGTH
    : PAYOUT_SCRIPT_HASH_SCRIPT_LENGTH
}

export function payoutSweepVsizeForDestination(destination: string): number {
  return payoutSweepVsizeForScriptLength(payoutSweepScriptLength(destination))
}

export const PAYOUT_LOCKTIME_SAFETY_BLOCKS = 30

export const PAYOUT_MIN_OUTPUT_VALUE = 330

const PPM_SCALE = 100_000_000

export type OnchainPayoutStage =
  | 'quoted'
  | 'paying'
  | 'funded'
  | 'sweeping'
  | 'completed'
  | 'refunded'
  | 'aborted'

const STAGE_PHASE: Record<OnchainPayoutStage, TransferPhase> = {
  quoted: 'preparing',
  paying: 'submitted',
  funded: 'in_transit',
  sweeping: 'awaiting_confirmation',
  completed: 'settled',
  refunded: 'failed',
  aborted: 'failed',
}

export function payoutPhase(stage: OnchainPayoutStage): TransferPhase {
  return STAGE_PHASE[stage]
}

export function advancePayoutStage(
  transfer: PendingTransfer,
  stage: OnchainPayoutStage,
  now: number,
): PendingTransfer {
  return transitionPhase(transfer, STAGE_PHASE[stage], now)
}

export function isPayoutStageTerminal(stage: OnchainPayoutStage): boolean {
  return stage === 'completed' || stage === 'refunded' || stage === 'aborted'
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
}

function feePercentToPpm(feePercent: number): number {
  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent >= 100) {
    throw new RangeError('feePercent must be in [0, 100)')
  }
  return Math.round(feePercent * 1_000_000)
}

function ceilDiv(a: number, b: number): number {
  const quotient = Math.floor(a / b)
  return quotient * b < a ? quotient + 1 : quotient
}

export function payoutReceiveAmount(params: {
  sendAmount: number
  feePercent: number
  networkFee: number
}): number {
  const { sendAmount, feePercent, networkFee } = params
  const feePpm = feePercentToPpm(feePercent)
  assertNonNegativeInteger('sendAmount', sendAmount)
  assertNonNegativeInteger('networkFee', networkFee)
  const fee = ceilDiv(sendAmount * feePpm, PPM_SCALE)
  return sendAmount - fee - networkFee
}

export function payoutSendAmount(params: {
  receiveAmount: number
  feePercent: number
  networkFee: number
}): number {
  const { receiveAmount, feePercent, networkFee } = params
  const feePpm = feePercentToPpm(feePercent)
  assertNonNegativeInteger('receiveAmount', receiveAmount)
  assertNonNegativeInteger('networkFee', networkFee)
  return ceilDiv((receiveAmount + networkFee) * PPM_SCALE, PPM_SCALE - feePpm)
}

export interface PayoutEstimate {
  readonly sendAmount: number
  readonly receiveAmount: number
  readonly serviceFee: number
  readonly networkFee: number
  readonly payoutFee: number
}

export type PayoutEstimateParams = {
  readonly feePercent: number
  readonly networkFee: number
  readonly payoutFeeRate: number
  readonly destination: string
} & (
  | { readonly sendAmount: number; readonly receiveAmount?: undefined }
  | { readonly receiveAmount: number; readonly sendAmount?: undefined }
)

export function estimatePayout(params: PayoutEstimateParams): PayoutEstimate {
  const { feePercent, networkFee, payoutFeeRate, destination } = params
  if (!Number.isFinite(payoutFeeRate) || payoutFeeRate < 0) {
    throw new RangeError('payoutFeeRate must be a non-negative number')
  }
  const payoutFeeEstimate = payoutSweepFee(
    payoutFeeRate,
    payoutSweepVsizeForDestination(destination),
  )
  if (params.sendAmount !== undefined) {
    const { sendAmount } = params
    const receiveAmount =
      payoutReceiveAmount({ sendAmount, feePercent, networkFee }) - payoutFeeEstimate
    return {
      sendAmount,
      receiveAmount,
      serviceFee: sendAmount - receiveAmount - networkFee - payoutFeeEstimate,
      networkFee,
      payoutFee: payoutFeeEstimate,
    }
  }
  const { receiveAmount } = params
  assertNonNegativeInteger('receiveAmount', receiveAmount)
  const sendAmount = payoutSendAmount({
    receiveAmount: receiveAmount + payoutFeeEstimate,
    feePercent,
    networkFee,
  })
  return {
    sendAmount,
    receiveAmount,
    serviceFee: sendAmount - receiveAmount - networkFee - payoutFeeEstimate,
    networkFee,
    payoutFee: payoutFeeEstimate,
  }
}

export function payoutUpfrontAmount(networkFee: number): number {
  return 2 * networkFee
}

export function payoutSweepFee(
  feeRateSatPerVb: number,
  vsize: number = PAYOUT_SWEEP_VSIZE,
): number {
  return Math.ceil(vsize * feeRateSatPerVb)
}

export function isPayoutAmountInRange(
  amount: number,
  range: { min: number; max: number },
): boolean {
  return amount >= range.min && amount <= range.max
}

export interface PayoutFundingOutput {
  readonly value: number
  readonly confirmedHeight: number | null
}

export interface PayoutOutputSpend {
  readonly byUs: boolean
  readonly confirmed: boolean
}

export interface PayoutSweepInput {
  readonly expectedAmount: number
  readonly locktime: number
  readonly currentHeight: number
  readonly output: PayoutFundingOutput | null
  readonly spend: PayoutOutputSpend | null
  readonly secretRevealed: boolean
}

export type PayoutSweepAction =
  | 'wait'
  | 'sweep'
  | 'rebroadcast'
  | 'done'
  | 'refuse'

export type PayoutSweepReason =
  | 'not_funded'
  | 'unconfirmed'
  | 'underpaid'
  | 'expired'
  | 'too_close_to_locktime'
  | 'spent_by_provider'
  | 'ready'
  | 'revealed'
  | 'confirmed'

export interface PayoutSweepDecision {
  readonly action: PayoutSweepAction
  readonly reason: PayoutSweepReason
}

export function decidePayoutSweep(input: PayoutSweepInput): PayoutSweepDecision {
  const { expectedAmount, locktime, currentHeight, output, spend, secretRevealed } = input
  const safetyHeight = locktime - PAYOUT_LOCKTIME_SAFETY_BLOCKS

  if (spend?.byUs && spend.confirmed) {
    return { action: 'done', reason: 'confirmed' }
  }
  if (spend && !spend.byUs && spend.confirmed) {
    return { action: 'refuse', reason: 'spent_by_provider' }
  }
  if (spend?.byUs) {
    return { action: 'rebroadcast', reason: 'revealed' }
  }
  if (secretRevealed) {
    return { action: 'rebroadcast', reason: 'revealed' }
  }
  if (spend && !spend.byUs) {
    return { action: 'refuse', reason: 'spent_by_provider' }
  }
  if (output === null) {
    return currentHeight >= locktime
      ? { action: 'refuse', reason: 'expired' }
      : { action: 'wait', reason: 'not_funded' }
  }
  if (output.value < expectedAmount) {
    return { action: 'wait', reason: 'underpaid' }
  }
  if (output.confirmedHeight === null) {
    return currentHeight >= safetyHeight
      ? { action: 'refuse', reason: 'too_close_to_locktime' }
      : { action: 'wait', reason: 'unconfirmed' }
  }
  if (output.confirmedHeight >= safetyHeight || currentHeight >= safetyHeight) {
    return { action: 'refuse', reason: 'too_close_to_locktime' }
  }
  return { action: 'sweep', reason: 'ready' }
}

export interface PayoutSweepOutput {
  readonly address: string
  readonly value: number
}

export interface PayoutSweepPlan {
  readonly inputValue: number
  readonly outputs: readonly PayoutSweepOutput[]
  readonly fee: number
  readonly maxFee: number
  readonly destination: string
  readonly fundingConfirmations: number
}

export function validatePayoutSweep(plan: PayoutSweepPlan): Result<void, string> {
  const { inputValue, outputs, fee, maxFee, destination, fundingConfirmations } = plan

  if (outputs.length !== 1) return Err('expected exactly one output')
  const [output] = outputs
  if (output.address !== destination) return Err('output address is not the destination')
  if (output.value !== inputValue - fee) return Err('output value is not input minus fee')
  if (fee <= 0) return Err('fee must be positive')
  if (fee > maxFee) return Err('fee exceeds the maximum')
  if (output.value <= 0) return Err('output value must be positive')
  if (output.value < PAYOUT_MIN_OUTPUT_VALUE) return Err('output value is below dust')
  if (fundingConfirmations < 1) return Err('funding is not confirmed')
  return Ok(undefined)
}
