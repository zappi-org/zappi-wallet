import { PAYOUT_MIN_OUTPUT_VALUE } from '@/core/domain/swap-out'

export function bumpFloor(lastSweepFee: number, sweepVsize: number): number {
  return lastSweepFee + sweepVsize
}

export function revealCap(fundingValue: number): number {
  return fundingValue - PAYOUT_MIN_OUTPUT_VALUE
}

export function cappedFee(target: number, cap: number): number {
  return Math.min(target, cap)
}

export function conflictTarget(
  rateFee: number,
  conflictFee: number,
  conflictVsize: number,
  sweepVsize: number,
): number {
  return Math.max(
    rateFee,
    conflictFee + sweepVsize,
    Math.ceil((conflictFee * sweepVsize) / conflictVsize) + sweepVsize,
  )
}

export function escalationTarget(
  rateFee: number,
  lastSweepFee: number,
  minimum: number,
): number {
  return Math.max(rateFee, Math.ceil(lastSweepFee * 1.5), minimum)
}
