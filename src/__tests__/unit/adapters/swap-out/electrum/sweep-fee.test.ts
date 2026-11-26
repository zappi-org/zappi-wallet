import { describe, expect, it } from 'vitest'
import {
  bumpFloor,
  cappedFee,
  conflictTarget,
  escalationTarget,
  revealCap,
} from '@/adapters/swap-out/electrum/sweep-fee'
import { PAYOUT_MIN_OUTPUT_VALUE } from '@/core/domain/swap-out'

describe('sweep-fee', () => {
  it('adds one sweep vsize to the last fee for the bump floor', () => {
    expect(bumpFloor(272, 136)).toBe(408)
    expect(bumpFloor(6800, 110)).toBe(6910)
  })

  it('caps the fee so the reward output keeps its minimum value', () => {
    expect(revealCap(77000)).toBe(77000 - PAYOUT_MIN_OUTPUT_VALUE)
    expect(revealCap(1000)).toBe(670)
  })

  it('never lets a target exceed the cap', () => {
    expect(cappedFee(6936, 76670)).toBe(6936)
    expect(cappedFee(80000, 76670)).toBe(76670)
    expect(cappedFee(-1, 100)).toBe(-1)
  })

  it('beats the conflict on absolute fee and on fee rate', () => {
    expect(conflictTarget(272, 6400, 128, 136)).toBe(6936)
    expect(conflictTarget(7000, 6400, 128, 136)).toBe(7000)
    expect(conflictTarget(272, 7000, 200, 136)).toBe(7136)
  })

  it('rounds the conflict fee rate up before adding the sweep vsize', () => {
    expect(conflictTarget(0, 1001, 100, 136)).toBe(1498)
  })

  it('raises the fee by half, but never below the rate fee or the floor', () => {
    expect(escalationTarget(408, 272, 408)).toBe(408)
    expect(escalationTarget(100, 272, 408)).toBe(408)
    expect(escalationTarget(100, 400, 200)).toBe(600)
  })
})
