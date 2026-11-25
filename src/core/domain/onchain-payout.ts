import {
  transitionPhase,
  type PendingTransfer,
  type TransferPhase,
} from './pending-transfer'
import { Err, Ok, type Result } from './result'

export const PAYOUT_SWEEP_VSIZE = 136

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
