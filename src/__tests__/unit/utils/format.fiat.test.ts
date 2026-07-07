/**
 * fiatToSats / satsToFiat — amount conversion boundary safety net.
 *
 * Detects regressions where a later refactor silently changes the rounding
 * direction, sign handling, or abnormal-input handling. These pins document the
 * "current contract"; NaN/Infinity passing through makes explicit the premise that
 * callers (AmountInput, use-fiat-toggle) guard the input — changing it must be a deliberate decision.
 */
import { describe, it, expect } from 'vitest'
import { fiatToSats, satsToFiat } from '@/utils/format'

const RATE = 100_000 // 1 BTC = 100,000 (arbitrary fiat) → 1 sat = 0.001

describe('fiatToSats', () => {
  it.each([
    // [fiat, rate, expected sats, meaning]
    [0, RATE, 0, '0은 0'],
    [0.001, RATE, 1, '정확히 1 sat'],
    [100_000, RATE, 100_000_000, '1 BTC 상당 → 1e8 sats'],
    [0.0004, RATE, 0, '0.4 sat → 내림 (1 sat 미만 소액 소멸)'],
    [0.0005, RATE, 1, '0.5 sat → 올림 (Math.round 반올림 방향: half-up)'],
    [0.0014, RATE, 1, '1.4 sat → 1'],
    [0.0025, RATE, 3, '2.5 sat → 3 (half-up)'],
    // a decimal half doesn't always round up — 0.0015/1e5*1e8 reaches 1.4999... in binary
    // float and becomes 1. Contract: a ±1 sat error is within tolerance for display/input conversion.
    [0.0015, RATE, 1, '1.5 sat 이지만 float 표현상 1.4999... → 1'],
    [-0.001, RATE, -1, '부호 통과 (음수 가드는 호출부 책임)'],
  ])('fiatToSats(%s, %s) = %s — %s', (fiat, rate, expected) => {
    expect(fiatToSats(fiat, rate)).toBe(expected)
  })

  it('return value is always an integer (no sub-sat unit)', () => {
    expect(Number.isInteger(fiatToSats(12.3456789, 97_531))).toBe(true)
  })

  it('round-trip: satsToFiat → fiatToSats restores the original sat value', () => {
    for (const sats of [1, 21, 12_345, 99_999_999]) {
      expect(fiatToSats(satsToFiat(sats, 97_531), 97_531)).toBe(sats)
    }
  })

  it('[current contract] abnormal input propagates as-is — assumes caller guards', () => {
    expect(fiatToSats(NaN, RATE)).toBeNaN()
    expect(fiatToSats(1, NaN)).toBeNaN()
    expect(fiatToSats(1, 0)).toBe(Infinity)
  })
})

describe('satsToFiat', () => {
  it('1 sat → rate/1e8', () => {
    expect(satsToFiat(1, RATE)).toBeCloseTo(0.001, 10)
  })

  it('0 sat → 0', () => {
    expect(satsToFiat(0, RATE)).toBe(0)
  })

  it('1e8 sats(1 BTC) → rate as-is', () => {
    expect(satsToFiat(100_000_000, RATE)).toBeCloseTo(RATE, 6)
  })

  it('[current contract] does not round — display rounding belongs to formatFiatAmount', () => {
    // 21 sats @ 100k = 0.021 — must return the raw decimal so the display layer can decide per-currency digits
    expect(satsToFiat(21, RATE)).toBeCloseTo(0.021, 10)
  })
})
